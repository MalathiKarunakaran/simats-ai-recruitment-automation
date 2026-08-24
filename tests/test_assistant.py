import json
from datetime import timedelta
from types import SimpleNamespace

import httpx
import openai
import pytest
from fastapi import HTTPException

from app.core.deps import CampusScope, DepartmentScope
from app.models.audit_log import AuditLog
from app.models.enums import StaffRoleCategoryEnum, UserRoleEnum
from app.services import hermes

from tests.conftest import (
    FakeOpenAIChoiceMessage,
    FakeOpenAIResponse,
    FakeOpenAIToolCall,
    auth_headers,
)


def _text_response(text: str) -> FakeOpenAIResponse:
    return FakeOpenAIResponse(FakeOpenAIChoiceMessage(content=text, tool_calls=None))


def _tool_call_response(*tool_calls: FakeOpenAIToolCall) -> FakeOpenAIResponse:
    return FakeOpenAIResponse(FakeOpenAIChoiceMessage(content=None, tool_calls=list(tool_calls)))


class _ScriptedClient:
    """Fake OpenAI client whose chat.completions.create returns a scripted
    sequence of responses, one per call -- used to drive
    hermes.run_assistant_query through multi-turn tool-calling loops
    deterministically. Records every call's kwargs for inspection."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        if not self._responses:
            raise AssertionError("Scripted client ran out of responses")
        return self._responses.pop(0)


def _tool_messages(scripted_client: _ScriptedClient, call_index: int) -> list[dict]:
    """Every `role: tool` message appended after the most recent
    `role: assistant` tool-calling turn in the given call's `messages` kwarg
    -- OpenAI's shape appends one `tool` message per tool call (unlike
    Anthropic's single `user` message carrying a list of tool_result content
    blocks), so tests must collect them rather than reading one list index."""
    messages = scripted_client.calls[call_index]["messages"]
    last_assistant_idx = max(
        i for i, m in enumerate(messages) if m["role"] == "assistant" and m.get("tool_calls")
    )
    return [m for m in messages[last_assistant_idx + 1 :] if m["role"] == "tool"]


def _last_tool_result_payload(scripted_client: _ScriptedClient, call_index: int, block_index: int = 0) -> dict:
    return json.loads(_tool_messages(scripted_client, call_index)[block_index]["content"])


def test_single_campus_caller_cannot_see_other_campus_data(db_session, published_vacancy_factory):
    vacancy_sse = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_scad = published_vacancy_factory(campus_code="SCAD", slot_count=1)

    scope = CampusScope(is_global=False, campus_id=vacancy_sse.campus.id)
    scripted = _ScriptedClient(
        [
            _tool_call_response(FakeOpenAIToolCall("list_open_vacancies", {"campus_code": "SCAD"})),
            _text_response("Here is what I found."),
        ]
    )

    # run_assistant_query now also returns a 3rd `actions` element (Step 6,
    # deterministic actions metadata) -- discarded here, not asserted on by
    # this test.
    answer, tools_used, _actions = hermes.run_assistant_query(
        db_session, scope=scope, client=scripted, question="What's open at SCAD?", actor_role="CAMPUS_HOD"
    )

    assert tools_used == ["list_open_vacancies"]
    payload = _last_tool_result_payload(scripted, 1)
    assert "your home campus" in payload["scope_note"]
    campus_codes = {row["campus_code"] for row in payload["results"]}
    assert campus_codes <= {"SSE"}
    assert "SCAD" not in campus_codes
    assert vacancy_scad.job_posting.public_apply_slug not in json.dumps(payload)
    assert answer == "Here is what I found."


def test_global_caller_narrows_via_campus_code(db_session, published_vacancy_factory):
    published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_scad = published_vacancy_factory(campus_code="SCAD", slot_count=1)

    scope = CampusScope(is_global=True, campus_id=None)
    scripted = _ScriptedClient(
        [
            _tool_call_response(FakeOpenAIToolCall("list_open_vacancies", {"campus_code": "SCAD"})),
            _text_response("SCAD only."),
        ]
    )

    hermes.run_assistant_query(db_session, scope=scope, client=scripted, question="q", actor_role="HR_ADMIN")

    payload = _last_tool_result_payload(scripted, 1)
    assert payload["scope_note"] == "Limited to campus SCAD."
    campus_codes = {row["campus_code"] for row in payload["results"]}
    assert campus_codes == {"SCAD"}


def test_global_caller_with_no_campus_code_spans_all_campuses(db_session, published_vacancy_factory):
    published_vacancy_factory(campus_code="SSE", slot_count=1)
    published_vacancy_factory(campus_code="SCAD", slot_count=1)

    scope = CampusScope(is_global=True, campus_id=None)
    scripted = _ScriptedClient(
        [
            _tool_call_response(FakeOpenAIToolCall("list_open_vacancies", {})),
            _text_response("Org-wide view."),
        ]
    )

    hermes.run_assistant_query(db_session, scope=scope, client=scripted, question="q", actor_role="HR_ADMIN")

    payload = _last_tool_result_payload(scripted, 1)
    assert payload["scope_note"] == "Global access: results span all campuses."
    campus_codes = {row["campus_code"] for row in payload["results"]}
    assert {"SSE", "SCAD"} <= campus_codes


def test_invalid_campus_code_from_global_caller_returns_empty_not_error(db_session, published_vacancy_factory):
    published_vacancy_factory(campus_code="SSE", slot_count=1)

    scope = CampusScope(is_global=True, campus_id=None)
    scripted = _ScriptedClient(
        [
            _tool_call_response(FakeOpenAIToolCall("list_open_vacancies", {"campus_code": "ZZZZ"})),
            _text_response("No such campus."),
        ]
    )

    hermes.run_assistant_query(db_session, scope=scope, client=scripted, question="q", actor_role="HR_ADMIN")

    payload = _last_tool_result_payload(scripted, 1)
    assert payload["count"] == 0
    assert "No campus found with code 'ZZZZ'" in payload["scope_note"]


def test_parallel_tool_calls_in_one_turn_all_execute(db_session, published_vacancy_factory):
    published_vacancy_factory(campus_code="SSE", slot_count=1)
    scope = CampusScope(is_global=True, campus_id=None)
    scripted = _ScriptedClient(
        [
            _tool_call_response(
                FakeOpenAIToolCall("list_open_vacancies", {}, id="tu_1"),
                FakeOpenAIToolCall("pipeline_status_counts", {}, id="tu_2"),
            ),
            _text_response("Combined answer."),
        ]
    )

    answer, tools_used, _actions = hermes.run_assistant_query(
        db_session, scope=scope, client=scripted, question="q", actor_role="HR_ADMIN"
    )

    assert set(tools_used) == {"list_open_vacancies", "pipeline_status_counts"}
    tool_results = _tool_messages(scripted, 1)
    assert len(tool_results) == 2
    assert {r["tool_call_id"] for r in tool_results} == {"tu_1", "tu_2"}
    assert answer == "Combined answer."


def test_iteration_cap_raises_502_after_six_calls(db_session, campus_factory):
    # _MAX_TOOL_CALLS was raised from 4 to 6 (app/services/hermes.py) once
    # the reporting-tool set roughly tripled the number of available tools --
    # a compound question can legitimately need more sequential round trips
    # before the model has enough to answer. Updated here to match.
    campus_factory("SSE")
    scope = CampusScope(is_global=True, campus_id=None)
    calls: list[dict] = []

    def _always_tool_use(**kwargs):
        calls.append(kwargs)
        return _tool_call_response(FakeOpenAIToolCall("pipeline_status_counts", {}))

    scripted = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=_always_tool_use)))

    with pytest.raises(HTTPException) as exc_info:
        hermes.run_assistant_query(db_session, scope=scope, client=scripted, question="q", actor_role="HR_ADMIN")

    assert exc_info.value.status_code == 502
    assert len(calls) == hermes._MAX_TOOL_CALLS


def test_plain_text_answer_passes_through_without_forcing_a_tool(db_session, campus_factory):
    # Renamed from test_reporting_question_passes_through_without_forcing_a_tool
    # -- reporting questions now DO route to a real tool (HERMES_SYSTEM_PROMPT
    # rule 2 was rewritten; reporting is no longer "not available yet"). What
    # this test actually exercises -- a scripted no-tool-call text response
    # passing straight through with zero tool calls -- is unrelated to that
    # wording and still a real behavior worth covering.
    campus_factory("SSE")
    scope = CampusScope(is_global=True, campus_id=None)
    scripted = _ScriptedClient([_text_response("All quiet.")])

    answer, tools_used, actions = hermes.run_assistant_query(
        db_session, scope=scope, client=scripted, question="Any updates?", actor_role="HR_ADMIN"
    )

    assert tools_used == []
    assert answer == "All quiet."
    assert actions == []
    assert len(scripted.calls) == 1


def test_unknown_tool_name_produces_error_result_and_loop_continues(db_session, campus_factory):
    campus_factory("SSE")
    scope = CampusScope(is_global=True, campus_id=None)
    scripted = _ScriptedClient(
        [
            _tool_call_response(FakeOpenAIToolCall("delete_everything", {})),
            _text_response("I can't do that."),
        ]
    )

    answer, tools_used, actions = hermes.run_assistant_query(
        db_session, scope=scope, client=scripted, question="q", actor_role="HR_ADMIN"
    )

    assert tools_used == []
    assert actions == []
    tool_results = _tool_messages(scripted, 1)
    assert "Unknown tool" in json.loads(tool_results[0]["content"])["error"]
    assert answer == "I can't do that."


def test_ai_rate_limit_error_maps_to_503(client, user_factory, fake_openai_client):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    def _raise_rate_limit(**kwargs):
        req = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
        resp = httpx.Response(429, request=req)
        raise openai.RateLimitError("rate limited", response=resp, body=None)

    fake_openai_client.chat.completions.create = _raise_rate_limit

    response = client.post(
        "/api/v1/assistant/query", headers=auth_headers(client, hr_admin), json={"question": "Any updates?"}
    )
    assert response.status_code == 503


def test_ai_connection_error_maps_to_502(client, user_factory, fake_openai_client):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    def _raise_connection_error(**kwargs):
        req = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
        raise openai.APIConnectionError(request=req)

    fake_openai_client.chat.completions.create = _raise_connection_error

    response = client.post(
        "/api/v1/assistant/query", headers=auth_headers(client, hr_admin), json={"question": "Any updates?"}
    )
    assert response.status_code == 502


def test_candidate_cannot_use_assistant(client, user_factory, fake_openai_client):
    candidate_user = user_factory(UserRoleEnum.CANDIDATE)
    fake_openai_client.chat.completions.create = lambda **kwargs: _text_response("n/a")

    response = client.post(
        "/api/v1/assistant/query", headers=auth_headers(client, candidate_user), json={"question": "q"}
    )
    assert response.status_code == 403

    response = client.get("/api/v1/assistant/daily-briefing", headers=auth_headers(client, candidate_user))
    assert response.status_code == 403


def test_hod_can_query_assistant_and_audit_log_is_written(client, user_factory, fake_openai_client, db_session):
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    fake_openai_client.chat.completions.create = lambda **kwargs: _text_response("There are no pending approvals.")

    response = client.post(
        "/api/v1/assistant/query",
        headers=auth_headers(client, hod),
        json={"question": "Any pending approvals?"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == "There are no pending approvals."
    assert body["tools_used"] == []

    rows = db_session.query(AuditLog).filter(AuditLog.action == "ASSISTANT_QUERY").all()
    assert len(rows) == 1
    assert rows[0].after_state["question"] == "Any pending approvals?"
    assert rows[0].after_state["answer"] == "There are no pending approvals."
    assert rows[0].campus_context_id == hod.campus_id


def test_daily_briefing_stats_scoped_per_campus(db_session, published_vacancy_factory):
    vacancy_sse = published_vacancy_factory(campus_code="SSE", slot_count=2)
    published_vacancy_factory(campus_code="SCAD", slot_count=1)

    hod_scope = CampusScope(is_global=False, campus_id=vacancy_sse.campus.id)
    hod_stats = hermes.build_daily_briefing_stats(db_session, hod_scope)
    assert hod_stats["open_vacancies"] == 1
    assert "your home campus" in hod_stats["scope_note"]

    global_scope = CampusScope(is_global=True, campus_id=None)
    global_stats = hermes.build_daily_briefing_stats(db_session, global_scope)
    assert global_stats["open_vacancies"] == 2
    assert global_stats["scope_note"] == "Global access: results span all campuses."


def test_daily_briefing_endpoint_uses_narrative_from_single_call(client, user_factory, fake_openai_client, db_session):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    calls = []

    def _create(**kwargs):
        calls.append(kwargs)
        return _text_response("All quiet today.")

    fake_openai_client.chat.completions.create = _create

    response = client.get("/api/v1/assistant/daily-briefing", headers=auth_headers(client, hr_admin))
    assert response.status_code == 200
    body = response.json()
    assert body["narrative"] == "All quiet today."
    assert "pending_vacancy_approvals" in body["stats"]
    assert len(calls) == 1
    assert "tools" not in calls[0]

    rows = db_session.query(AuditLog).filter(AuditLog.action == "ASSISTANT_DAILY_BRIEFING").all()
    assert len(rows) == 1


# --- New reporting-tool coverage --------------------------------------------


def test_get_vacancy_summary_reports_open_positions_and_actions(db_session, published_vacancy_factory):
    published_vacancy_factory(campus_code="SSE", slot_count=2)
    scope = CampusScope(is_global=True, campus_id=None)
    scripted = _ScriptedClient(
        [
            _tool_call_response(FakeOpenAIToolCall("get_vacancy_summary", {})),
            _text_response("Summary provided."),
        ]
    )

    answer, tools_used, actions = hermes.run_assistant_query(
        db_session, scope=scope, client=scripted, question="How are vacancies looking?", actor_role="HR_ADMIN"
    )

    assert tools_used == ["get_vacancy_summary"]
    payload = _last_tool_result_payload(scripted, 1)
    assert payload["total_open_positions"] == 2
    assert "by_category" in payload
    assert len(payload["by_category"]) == 3
    assert answer == "Summary provided."
    assert any(a["type"] == "open_page" and a["path"] == "/dashboard" for a in actions)


def test_get_department_vacancies_sorted_desc_and_min_vacancy_count_filter(
    db_session, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory
):
    campus = campus_factory("SSE")
    dept_high = department_factory("SSE", name="CS Dept", category=StaffRoleCategoryEnum.TEACHING)
    dept_low = department_factory("SSE", name="Physics Dept", category=StaffRoleCategoryEnum.TEACHING)
    admin = user_factory(UserRoleEnum.HR_ADMIN)
    designation_high = designation_factory(category=StaffRoleCategoryEnum.TEACHING, department=dept_high)
    designation_low = designation_factory(category=StaffRoleCategoryEnum.TEACHING, department=dept_low)
    sanctioned_strength_factory(
        campus=campus, department=dept_high, designation=designation_high, approved_strength=10, created_by=admin
    )
    sanctioned_strength_factory(
        campus=campus, department=dept_low, designation=designation_low, approved_strength=3, created_by=admin
    )

    scope = CampusScope(is_global=True, campus_id=None)
    unrestricted = DepartmentScope(is_restricted=False, department_ids=None)

    result = hermes.TOOL_EXECUTORS["get_department_vacancies"](db_session, scope, unrestricted, {})
    names_in_order = [r["department_name"] for r in result["results"]]
    assert names_in_order.index(dept_high.name) < names_in_order.index(dept_low.name)

    filtered = hermes.TOOL_EXECUTORS["get_department_vacancies"](
        db_session, scope, unrestricted, {"min_vacancy_count": 5}
    )
    filtered_names = {r["department_name"] for r in filtered["results"]}
    assert dept_high.name in filtered_names
    assert dept_low.name not in filtered_names


def test_get_open_vacancy_aging_filters_by_min_days_open(db_session, published_vacancy_factory):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy.job_posting.published_at = vacancy.job_posting.published_at - timedelta(days=40)
    db_session.flush()

    scope = CampusScope(is_global=True, campus_id=None)
    unrestricted = DepartmentScope(is_restricted=False, department_ids=None)

    result = hermes.TOOL_EXECUTORS["get_open_vacancy_aging"](db_session, scope, unrestricted, {"min_days_open": 30})
    assert result["count"] == 1
    assert result["results"][0]["days_open"] >= 30

    empty = hermes.TOOL_EXECUTORS["get_open_vacancy_aging"](db_session, scope, unrestricted, {"min_days_open": 100})
    assert empty["count"] == 0


def test_department_scope_restricts_department_vacancy_tools(
    db_session, campus_factory, department_factory, designation_factory, sanctioned_strength_factory, user_factory
):
    campus = campus_factory("SSE")
    dept_allowed = department_factory("SSE", name="Allowed Dept", category=StaffRoleCategoryEnum.TEACHING)
    dept_blocked = department_factory("SSE", name="Blocked Dept", category=StaffRoleCategoryEnum.TEACHING)
    admin = user_factory(UserRoleEnum.HR_ADMIN)
    designation_allowed = designation_factory(category=StaffRoleCategoryEnum.TEACHING, department=dept_allowed)
    designation_blocked = designation_factory(category=StaffRoleCategoryEnum.TEACHING, department=dept_blocked)
    sanctioned_strength_factory(
        campus=campus, department=dept_allowed, designation=designation_allowed, approved_strength=5, created_by=admin
    )
    sanctioned_strength_factory(
        campus=campus, department=dept_blocked, designation=designation_blocked, approved_strength=5, created_by=admin
    )

    scope = CampusScope(is_global=True, campus_id=None)
    restricted = DepartmentScope(is_restricted=True, department_ids=frozenset({dept_allowed.id}))

    result = hermes.TOOL_EXECUTORS["get_department_vacancies"](db_session, scope, restricted, {})
    names = {r["department_name"] for r in result["results"]}
    assert names == {dept_allowed.name}

    # An unrestricted caller sees both, proving the restriction above is what
    # narrowed the result, not some other filter.
    unrestricted = DepartmentScope(is_restricted=False, department_ids=None)
    unrestricted_result = hermes.TOOL_EXECUTORS["get_department_vacancies"](db_session, scope, unrestricted, {})
    unrestricted_names = {r["department_name"] for r in unrestricted_result["results"]}
    assert unrestricted_names == {dept_allowed.name, dept_blocked.name}


def test_resignation_linkage_fallback_instruction_present_and_no_vacancy_link_tool():
    assert (
        "That information is not currently available in the recruitment database."
        in hermes.HERMES_SYSTEM_PROMPT
    )
    resignation_tool_def = next(t for t in hermes.HERMES_TOOL_DEFS if t["function"]["name"] == "get_resignation_report")
    # get_resignation_report aggregates resignation *counts* -- it has no
    # vacancy-linking argument, so it (and every other tool) genuinely
    # cannot answer "was this vacancy caused by that resignation".
    assert "vacancy_request_id" not in resignation_tool_def["function"]["parameters"]["properties"]
    assert not any(
        "vacancy_request_id" in t["function"]["parameters"]["properties"]
        for t in hermes.HERMES_TOOL_DEFS
        if "resignation" in t["function"]["name"]
    )


def test_conversation_history_is_prepended_before_new_question(db_session, campus_factory):
    campus_factory("SSE")
    scope = CampusScope(is_global=True, campus_id=None)
    scripted = _ScriptedClient([_text_response("Sure, following up.")])

    history = [
        {"role": "user", "content": "How many vacancies at SSE?"},
        {"role": "assistant", "content": "There are 3 open vacancies at SSE."},
    ]
    answer, tools_used, actions = hermes.run_assistant_query(
        db_session,
        scope=scope,
        client=scripted,
        question="And how many of those are urgent?",
        actor_role="HR_ADMIN",
        conversation_history=history,
    )

    messages = scripted.calls[0]["messages"]
    # messages[0] is now the system prompt (OpenAI has no separate top-level
    # `system` param) -- history turns follow it, ahead of the new question.
    assert messages[0]["role"] == "system"
    assert messages[1] == {"role": "user", "content": "How many vacancies at SSE?"}
    assert messages[2] == {"role": "assistant", "content": "There are 3 open vacancies at SSE."}
    assert messages[3]["role"] == "user"
    assert "And how many of those are urgent?" in messages[3]["content"]
    assert answer == "Sure, following up."
    assert tools_used == []
    assert actions == []


def test_conversation_history_is_capped_to_max_turns(db_session, campus_factory):
    campus_factory("SSE")
    scope = CampusScope(is_global=True, campus_id=None)
    scripted = _ScriptedClient([_text_response("ok")])

    history = [{"role": "user", "content": f"turn {i}"} for i in range(20)]
    hermes.run_assistant_query(
        db_session,
        scope=scope,
        client=scripted,
        question="latest",
        actor_role="HR_ADMIN",
        conversation_history=history,
    )

    messages = scripted.calls[0]["messages"]
    # +1 for the system prompt, +1 for the new question, on top of the
    # capped history turns.
    assert len(messages) == hermes._MAX_CONVERSATION_HISTORY_TURNS + 2
    assert messages[1]["content"] == f"turn {20 - hermes._MAX_CONVERSATION_HISTORY_TURNS}"


def test_query_assistant_endpoint_accepts_conversation_history_and_returns_actions(
    client, user_factory, fake_openai_client, published_vacancy_factory
):
    published_vacancy_factory(campus_code="SSE", slot_count=1)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    def _create(**kwargs):
        last_message = kwargs["messages"][-1]
        if last_message["role"] == "user" and isinstance(last_message["content"], str):
            return _tool_call_response(FakeOpenAIToolCall("get_vacancy_summary", {}))
        return _text_response("Here's the summary.")

    fake_openai_client.chat.completions.create = _create

    response = client.post(
        "/api/v1/assistant/query",
        headers=auth_headers(client, hr_admin),
        json={
            "question": "Summarize vacancies",
            "conversation_history": [{"role": "user", "content": "Hi"}, {"role": "assistant", "content": "Hello!"}],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == "Here's the summary."
    assert body["tools_used"] == ["get_vacancy_summary"]
    assert isinstance(body["actions"], list)
    assert any(action["type"] == "open_page" for action in body["actions"])
