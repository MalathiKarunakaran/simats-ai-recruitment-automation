import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/api/joiningRecords";
import type { OrderRead, OrderSummary } from "@/api/joiningRecords";
import { ProvisionalOrdersPage } from "@/pages/ProvisionalOrdersPage";

vi.mock("@/api/joiningRecords", async () => {
  const actual = await vi.importActual<typeof import("@/api/joiningRecords")>("@/api/joiningRecords");
  return { ...actual, getOrderSummary: vi.fn(), listOrders: vi.fn() };
});

const mockedSummary = vi.mocked(api.getOrderSummary);
const mockedList = vi.mocked(api.listOrders);

function summary(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    total: 7,
    by_order_status: { ISSUED: 5, PENDING: 1, none: 1 },
    by_outcome: { PERMANENT_ORDER_RECEIVED: 1, PROBATION_EXTENDED: 1, NOT_RECOMMENDED: 1, none: 4 },
    probation_due30: 3,
    probation_overdue: 1,
    probation_ended: 2,
    unlinked: 6,
    today: "2026-10-31",
    last_sync_at: null,
    ...overrides,
  };
}

function order(overrides: Partial<OrderRead> = {}): OrderRead {
  return {
    id: "o-1",
    bio_id: "B100",
    emp_id: "E7",
    full_name: "Anitha R",
    order_on: "2026-05-01",
    order_on_raw: "01-05-2026",
    probation_end_on: "2026-11-10",
    probation_end_on_raw: "11/10/2026",
    order_status: "ISSUED",
    order_status_raw: "Issued",
    outcome: null,
    outcome_raw: null,
    id_card: "Yes",
    food_app: null,
    arms: "Done",
    app_360: null,
    file_submitted_adfa: null,
    room_allotted: "A-101",
    sheet_joinee_id: "j-1",
    is_active: true,
    sheet_row_number: 2,
    ...overrides,
  };
}

function renderPage(path = "/provisional-orders") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ProvisionalOrdersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function tileHref(label: string): string | null {
  return within(screen.getByTestId("order-tiles")).getByText(label).closest("a")?.getAttribute("href") ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSummary.mockResolvedValue(summary());
  mockedList.mockResolvedValue({ items: [order()], total: 1, limit: 25, offset: 0 });
});

describe("ProvisionalOrdersPage", () => {
  it("every tile links to the list filtered to what it counts", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("of 7 orders")).toBeInTheDocument());
    const p = "/provisional-orders";
    expect(tileHref("Issued")).toBe(`${p}?order_status=ISSUED#list`);
    expect(tileHref("Pending")).toBe(`${p}?order_status=PENDING#list`);
    expect(tileHref("Permanent order received")).toBe(`${p}?outcome=PERMANENT_ORDER_RECEIVED#list`);
    expect(tileHref("Probation extended")).toBe(`${p}?outcome=PROBATION_EXTENDED#list`);
    expect(tileHref("Not recommended")).toBe(`${p}?outcome=NOT_RECOMMENDED#list`);
    expect(tileHref("Probation ending in 30 days")).toBe(`${p}?probation=due30#list`);
    expect(tileHref("Overdue — no outcome")).toBe(`${p}?probation=overdue#list`);
    expect(tileHref("Not linked to a joiner")).toBe(`${p}?linked=false#list`);
    expect(within(screen.getByTestId("order-tiles")).getByText("3")).toBeInTheDocument();
  });

  it("states the date probation is measured from", async () => {
    renderPage();
    expect(await screen.findByText(/probation dates measured from 31 Oct 2026/)).toBeInTheDocument();
  });

  it("renders order date, probation end, the checklist, room and outcome", async () => {
    renderPage();
    const table = await screen.findByTestId("order-table");
    await within(table).findByText("Anitha R");
    expect(within(table).getByText("2026-05-01")).toBeInTheDocument();
    expect(within(table).getByText("2026-11-10")).toBeInTheDocument();
    expect(within(table).getByText("In 10d")).toBeInTheDocument();
    expect(within(table).getByText("ID card: Yes")).toBeInTheDocument();
    expect(within(table).getByText("Arms: Done")).toBeInTheDocument();
    expect(within(table).getByText("Food app")).toBeInTheDocument();
    expect(within(table).getByText("A-101")).toBeInTheDocument();
  });

  it("marks a past probation end with no outcome as overdue", async () => {
    mockedList.mockResolvedValue({
      items: [order({ probation_end_on: "2026-10-01" })],
      total: 1,
      limit: 25,
      offset: 0,
    });
    renderPage("/provisional-orders?probation=overdue");
    const table = await screen.findByTestId("order-table");
    expect(await within(table).findByText("Overdue")).toBeInTheDocument();
    expect(screen.getByTestId("joining-active-filters")).toHaveTextContent(
      "Overdue — probation ended, no outcome",
    );
    expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ probation: "overdue" }));
  });

  it("passes outcome=none and linked=false through to the API", async () => {
    renderPage("/provisional-orders?outcome=none&linked=false");
    const line = await screen.findByTestId("joining-active-filters");
    expect(line).toHaveTextContent("Outcome: No outcome · Not linked to a joiner");
    expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ outcome: "none", linked: false }));
  });

  it("a fresh load of a #list link scrolls once the list has loaded", async () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    renderPage("/provisional-orders?probation=due30#list");
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect(scroll.mock.contexts.at(-1)).toBe(document.getElementById("list"));
    scroll.mockRestore();
  });
});
