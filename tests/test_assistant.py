import json
from types import SimpleNamespace

import anthropic
import httpx
import pytest
from fastapi import HTTPException

from app.core.deps import CampusScope
from app.models.audit_log import AuditLog
from app.models.enums import UserRoleEnum
from app.services import hermes

from tests.conftest import FakeMessage, FakeTextBlock, FakeToolUseBlock, auth_headers


class _ScriptedClient:
    """Fake Anthropic client whose messages.create returns a scripted
    sequence of responses, one per call -- used to drive
    hermes.run_assistant_query through multi-turn tool-use loops
    deterministically. Records every call's kwargs for inspection."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls: list[dict] = []
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        if not self._responses:
            raise AssertionError("Scripted client ran out of responses")
        return self._responses.pop(0)


def _last_tool_result_payload(scripted_client: _ScriptedClient, call_index: int, block_index: int = 0) -> dict:
    messages = scripted_client.calls[call_index]["messages"]
    tool_results = messages[-1]["content"]
    return json.loads(tool_results[block_index]["content"])


def test_single_campus_caller_cannot_see_other_campus_data(db_session, published_vacancy_factory):
    vacancy_sse = published_vacancy_factory(campus_code="SSE", slot_count=1)
    vacancy_scad = published_vacancy_factory(campus_code="SCAD", slot_count=1)

    scope = CampusScope(is_global=False, campus_id=vacancy_sse.campus.id)
    scripted = _ScriptedClient(
        [
            FakeMessage(
                content=[FakeToolUseBlock("list_open_vacancies", {"campus_code": "SCAD"})], stop_reason="tool_use"
            ),
            FakeMessage(content=[FakeTextBlock("Here is what I found.")], stop_reason="end_turn"),
        ]
    )

    answer, tools_used = hermes.run_assistant_query(
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
            FakeMessage(
                content=[FakeToolUseBlock("list_open_vacancies", {"campus_code": "SCAD"})], stop_reason="tool_use"
            ),
            FakeMessage(content=[FakeTextBlock("SCAD only.")], stop_reason="end_turn"),
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
            FakeMessage(content=[FakeToolUseBlock("list_open_vacancies", {})], stop_reason="tool_use"),
            FakeMessage(content=[FakeTextBlock("Org-wide view.")], stop_reason="end_turn"),
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
            FakeMessage(
                content=[FakeToolUseBlock("list_open_vacancies", {"campus_code": "ZZZZ"})], stop_reason="tool_use"
            ),
            FakeMessage(content=[FakeTextBlock("No such campus.")], stop_reason="end_turn"),
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
            FakeMessage(
                content=[
                    FakeToolUseBlock("list_open_vacancies", {}, id="tu_1"),
                    FakeToolUseBlock("pipeline_status_counts", {}, id="tu_2"),
                ],
                stop_reason="tool_use",
            ),
            FakeMessage(content=[FakeTextBlock("Combined answer.")], stop_reason="end_turn"),
        ]
    )

    answer, tools_used = hermes.run_assistant_query(
        db_session, scope=scope, client=scripted, question="q", actor_role="HR_ADMIN"
    )

    assert set(tools_used) == {"list_open_vacancies", "pipeline_status_counts"}
    tool_results = scripted.calls[1]["messages"][-1]["content"]
    assert len(tool_results) == 2
    assert {r["tool_use_id"] for r in tool_results} == {"tu_1", "tu_2"}
    assert answer == "Combined answer."


def test_iteration_cap_raises_502_after_four_calls(db_session, campus_factory):
    campus_factory("SSE")
    scope = CampusScope(is_global=True, campus_id=None)
    calls: list[dict] = []

    def _always_tool_use(**kwargs):
        calls.append(kwargs)
        return FakeMessage(content=[FakeToolUseBlock("pipeline_status_counts", {})], stop_reason="tool_use")

    scripted = SimpleNamespace(messages=SimpleNamespace(create=_always_tool_use))

    with pytest.raises(HTTPException) as exc_info:
        hermes.run_assistant_query(db_session, scope=scope, client=scripted, question="q", actor_role="HR_ADMIN")

    assert exc_info.value.status_code == 502
    assert len(calls) == 4


def test_reporting_question_passes_through_without_forcing_a_tool(db_session, campus_factory):
    campus_factory("SSE")
    scope = CampusScope(is_global=True, campus_id=None)
    scripted = _ScriptedClient(
        [FakeMessage(content=[FakeTextBlock("Reporting isn't available yet.")], stop_reason="end_turn")]
    )

    answer, tools_used = hermes.run_assistant_query(
        db_session, scope=scope, client=scripted, question="Show me a dashboard", actor_role="HR_ADMIN"
    )

    assert tools_used == []
    assert answer == "Reporting isn't available yet."
    assert len(scripted.calls) == 1


def test_unknown_tool_name_produces_is_error_result_and_loop_continues(db_session, campus_factory):
    campus_factory("SSE")
    scope = CampusScope(is_global=True, campus_id=None)
    scripted = _ScriptedClient(
        [
            FakeMessage(content=[FakeToolUseBlock("delete_everything", {})], stop_reason="tool_use"),
            FakeMessage(content=[FakeTextBlock("I can't do that.")], stop_reason="end_turn"),
        ]
    )

    answer, tools_used = hermes.run_assistant_query(
        db_session, scope=scope, client=scripted, question="q", actor_role="HR_ADMIN"
    )

    assert tools_used == []
    tool_results = scripted.calls[1]["messages"][-1]["content"]
    assert tool_results[0]["is_error"] is True
    assert "Unknown tool" in json.loads(tool_results[0]["content"])["error"]
    assert answer == "I can't do that."


def test_ai_rate_limit_error_maps_to_503(client, user_factory, fake_ai_client):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    def _raise_rate_limit(**kwargs):
        req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        resp = httpx.Response(429, request=req)
        raise anthropic.RateLimitError("rate limited", response=resp, body=None)

    fake_ai_client.messages.create = _raise_rate_limit

    response = client.post(
        "/api/v1/assistant/query", headers=auth_headers(client, hr_admin), json={"question": "Any updates?"}
    )
    assert response.status_code == 503


def test_ai_connection_error_maps_to_502(client, user_factory, fake_ai_client):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)

    def _raise_connection_error(**kwargs):
        req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        raise anthropic.APIConnectionError(request=req)

    fake_ai_client.messages.create = _raise_connection_error

    response = client.post(
        "/api/v1/assistant/query", headers=auth_headers(client, hr_admin), json={"question": "Any updates?"}
    )
    assert response.status_code == 502


def test_candidate_cannot_use_assistant(client, user_factory, fake_ai_client):
    candidate_user = user_factory(UserRoleEnum.CANDIDATE)
    fake_ai_client.messages.create = lambda **kwargs: FakeMessage(
        content=[FakeTextBlock("n/a")], stop_reason="end_turn"
    )

    response = client.post(
        "/api/v1/assistant/query", headers=auth_headers(client, candidate_user), json={"question": "q"}
    )
    assert response.status_code == 403

    response = client.get("/api/v1/assistant/daily-briefing", headers=auth_headers(client, candidate_user))
    assert response.status_code == 403


def test_hod_can_query_assistant_and_audit_log_is_written(client, user_factory, fake_ai_client, db_session):
    hod = user_factory(UserRoleEnum.CAMPUS_HOD, campus_code="SSE")
    fake_ai_client.messages.create = lambda **kwargs: FakeMessage(
        content=[FakeTextBlock("There are no pending approvals.")], stop_reason="end_turn"
    )

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


def test_daily_briefing_endpoint_uses_narrative_from_single_call(client, user_factory, fake_ai_client, db_session):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    calls = []

    def _create(**kwargs):
        calls.append(kwargs)
        return FakeMessage(content=[FakeTextBlock("All quiet today.")], stop_reason="end_turn")

    fake_ai_client.messages.create = _create

    response = client.get("/api/v1/assistant/daily-briefing", headers=auth_headers(client, hr_admin))
    assert response.status_code == 200
    body = response.json()
    assert body["narrative"] == "All quiet today."
    assert "pending_vacancy_approvals" in body["stats"]
    assert len(calls) == 1
    assert "tools" not in calls[0]

    rows = db_session.query(AuditLog).filter(AuditLog.action == "ASSISTANT_DAILY_BRIEFING").all()
    assert len(rows) == 1
