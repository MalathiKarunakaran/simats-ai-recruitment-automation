import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/api/joiningRecords";
import type { JoineeDetail, JoineeRead, JoineeSummary } from "@/api/joiningRecords";
import { JoineesPage } from "@/pages/JoineesPage";

vi.mock("@/api/joiningRecords", async () => {
  const actual = await vi.importActual<typeof import("@/api/joiningRecords")>("@/api/joiningRecords");
  return {
    ...actual,
    getJoineeSummary: vi.fn(),
    listJoinees: vi.fn(),
    getJoinee: vi.fn(),
  };
});

const mockedSummary = vi.mocked(api.getJoineeSummary);
const mockedList = vi.mocked(api.listJoinees);
const mockedGet = vi.mocked(api.getJoinee);

function summary(overrides: Partial<JoineeSummary> = {}): JoineeSummary {
  return {
    total: 6,
    by_category: { TEACHING: 3, NON_TEACHING: 1, HOUSEKEEPING: 1, none: 1 },
    by_employment_state: { ACTIVE: 3, LEFT: 1, REJOINED: 1, none: 1 },
    by_campus: [
      { value: "SSE", count: 3 },
      { value: "SCLAS", count: 2 },
      { value: "none", count: 1 },
    ],
    monthly: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, count: i })),
    undated: 2,
    flagged: 2,
    linked_talent_pool: 2,
    last_sync_at: "2026-10-31T04:00:00Z",
    ...overrides,
  };
}

function joinee(overrides: Partial<JoineeRead> = {}): JoineeRead {
  return {
    id: "j-1",
    bio_id: "B100",
    new_bio_id: null,
    staff_id: "S9",
    app_no: null,
    full_name: "Anitha R",
    employee_type_raw: "TS",
    category: "TEACHING",
    college_raw: "SSE",
    campus_code: "SSE",
    status_raw: "New",
    employment_state: "ACTIVE",
    joined_on: "2026-10-01",
    joined_on_raw: "01-10-2026",
    designation: "Assistant Professor",
    department_raw: "CSE",
    dept_new_raw: null,
    reporting_to: null,
    talent_pool_entry_id: "tp-1",
    is_active: true,
    sheet_row_number: 2,
    ...overrides,
  };
}

function detail(): JoineeDetail {
  return {
    ...joinee(),
    interview_on: null,
    interview_on_raw: null,
    prov_order_given_on: null,
    prov_order_given_on_raw: null,
    send_on: null,
    send_on_raw: null,
    received_on: null,
    received_on_raw: null,
    relieving_order_submitted: null,
    original_submitted: "Yes",
    appointment_order: null,
    raw: { Name: "Anitha R", Designation: "Assistant Professor" },
    talent_pool_entry: { id: "tp-1", source_tab: "TEACHING_FINAL", sheet_status: "Selected", full_name: "Anitha Pool", is_active: true },
    provisional_order: {
      id: "o-1",
      bio_id: "B100",
      emp_id: null,
      full_name: "Anitha R",
      order_on: "2026-04-01",
      order_on_raw: null,
      probation_end_on: "2026-11-10",
      probation_end_on_raw: null,
      order_status: "ISSUED",
      order_status_raw: "Issued",
      outcome: null,
      outcome_raw: null,
      id_card: "Yes",
      food_app: null,
      arms: null,
      app_360: null,
      file_submitted_adfa: null,
      room_allotted: "A-101",
      sheet_joinee_id: "j-1",
      is_active: true,
      sheet_row_number: 3,
    },
  };
}

function page(items: JoineeRead[]) {
  return { items, total: items.length, limit: 25, offset: 0 };
}

function renderPage(path = "/joinees") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <JoineesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function tileHref(label: string): string | null {
  return within(screen.getByTestId("joinee-tiles")).getByText(label).closest("a")?.getAttribute("href") ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSummary.mockResolvedValue(summary());
  mockedList.mockResolvedValue(page([joinee()]));
  mockedGet.mockResolvedValue(detail());
});

describe("JoineesPage", () => {
  it("renders the eight tiles, each a link into the list", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("in the New Joinees sheet")).toBeInTheDocument());
    expect(tileHref("Total joiners")).toBe("/joinees#list");
    expect(tileHref("Teaching")).toBe("/joinees?category=TEACHING#list");
    expect(tileHref("Non-teaching")).toBe("/joinees?category=NON_TEACHING#list");
    expect(tileHref("Housekeeping")).toBe("/joinees?category=HOUSEKEEPING#list");
    expect(tileHref("No category")).toBe("/joinees?category=none#list");
    expect(tileHref("Left")).toBe("/joinees?employment_state=LEFT#list");
    expect(tileHref("Rejoined")).toBe("/joinees?employment_state=REJOINED#list");
    expect(tileHref("Linked to Talent Pool")).toBe("/joinees?linked_talent_pool=true#list");
  });

  it("links the by-campus rows, the flagged count and the undated note", async () => {
    renderPage();
    const campus = await screen.findByRole("link", { name: /No campus: 1/ });
    expect(campus).toHaveAttribute("href", "/joinees?campus_code=none#list");
    expect(screen.getByRole("link", { name: /SSE: 3/ })).toHaveAttribute("href", "/joinees?campus_code=SSE#list");
    expect(screen.getByRole("link", { name: /2 rows flagged by the last sync/ })).toHaveAttribute(
      "href",
      "/joinees?flagged=true#list",
    );
    expect(screen.getByRole("link", { name: /2 joiners have no readable joining date/ })).toHaveAttribute(
      "href",
      "/joinees?joined_month=undated#list",
    );
  });

  it("a count replaces the previous meaning and drops the search, but keeps removed rows", async () => {
    renderPage("/joinees?category=TEACHING&q=anitha&include_inactive=true");
    await waitFor(() => expect(screen.getByText("in the New Joinees sheet")).toBeInTheDocument());
    expect(tileHref("Left")).toBe("/joinees?include_inactive=true&employment_state=LEFT#list");
    expect(mockedSummary).toHaveBeenCalledWith(true);
  });

  it("passes URL filters to the list and says what is shown", async () => {
    renderPage("/joinees?category=none&campus_code=none&joined_month=undated#list");
    const line = await screen.findByTestId("joining-active-filters");
    await waitFor(() => expect(line).toHaveTextContent("1 joiner"));
    expect(line).toHaveTextContent("Category: No category · Campus: No campus · Joined: No readable joining date");
    expect(mockedList).toHaveBeenCalledWith(
      expect.objectContaining({ category: "none", campus_code: "none", joined_month: "undated", offset: 0 }),
    );
  });

  it("Clear filters empties the URL filters", async () => {
    renderPage("/joinees?employment_state=LEFT");
    const line = await screen.findByTestId("joining-active-filters");
    await userEvent.click(within(line).getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(screen.queryByTestId("joining-active-filters")).not.toBeInTheDocument());
    expect(mockedList).toHaveBeenLastCalledWith(expect.objectContaining({ employment_state: undefined }));
  });

  it("opens the side sheet with the linked Talent Pool entry and provisional order", async () => {
    renderPage();
    await userEvent.click(await within(await screen.findByTestId("joinee-table")).findByText("Anitha R"));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Anitha Pool")).toBeInTheDocument();
    expect(within(dialog).getByText("A-101")).toBeInTheDocument();
    expect(within(dialog).getByText("Issued")).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith("j-1");
  });

  it("a fresh load of a #list link scrolls once the list has loaded", async () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    let resolve: (value: ReturnType<typeof page>) => void = () => {};
    mockedList.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage("/joinees?employment_state=LEFT#list");
    await waitFor(() => expect(screen.getByText("in the New Joinees sheet")).toBeInTheDocument());
    expect(scroll).not.toHaveBeenCalled();
    resolve(page([joinee()]));
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll.mock.contexts.at(-1)).toBe(document.getElementById("list"));
    scroll.mockRestore();
  });

  it("does not scroll without the hash", async () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    renderPage("/joinees?employment_state=LEFT");
    await screen.findByTestId("joining-active-filters");
    await within(screen.getByTestId("joinee-table")).findByText("Anitha R");
    expect(scroll).not.toHaveBeenCalled();
    scroll.mockRestore();
  });

  it("says when nothing has synced yet", async () => {
    mockedSummary.mockResolvedValue(summary({ total: 0, last_sync_at: null }));
    renderPage();
    expect(await screen.findByText("No joiners synced yet")).toBeInTheDocument();
  });
});
