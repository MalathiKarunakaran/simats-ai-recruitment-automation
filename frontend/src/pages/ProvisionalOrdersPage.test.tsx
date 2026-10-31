import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "@/api/joiningRecords";
import type { OrderRead, OrderSummary } from "@/api/joiningRecords";
import type { UserRead, UserRole } from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { ProvisionalOrdersPage } from "@/pages/ProvisionalOrdersPage";
import { orderItems } from "@/test/orderItems";

vi.mock("@/api/joiningRecords", async () => {
  const actual = await vi.importActual<typeof import("@/api/joiningRecords")>("@/api/joiningRecords");
  return { ...actual, getOrderSummary: vi.fn(), listOrders: vi.fn(), markOrder: vi.fn() };
});
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedSummary = vi.mocked(api.getOrderSummary);
const mockedList = vi.mocked(api.listOrders);
const mockedMark = vi.mocked(api.markOrder);
const mockedUseAuth = vi.mocked(authContext.useAuth);

function signInAs(role: UserRole) {
  mockedUseAuth.mockReturnValue({ user: { role, full_name: "Signed In" } as UserRead } as ReturnType<typeof authContext.useAuth>);
}

function summary(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    total: 7,
    by_order_status: { ISSUED: 5, PENDING: 1, none: 1 },
    by_outcome: { PERMANENT_ORDER_RECEIVED: 1, PROBATION_EXTENDED: 1, NOT_RECOMMENDED: 1, none: 4 },
    probation_due30: 3,
    probation_overdue: 1,
    probation_ended: 2,
    unlinked: 6,
    registrar_order_issued: 1,
    registrar_order_pending: 6,
    orientation_conducted: 2,
    orientation_pending: 5,
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
    items: orderItems({
      id_card_done: { sheet: true, raw: "Yes" },
      arms_done: { sheet: true, raw: "Done" },
      room_allotted: { sheet: "A-101" },
      order_status: { sheet: "ISSUED", raw: "Issued" },
    }),
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
  signInAs("HR_ADMIN");
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
    expect(tileHref("Registrar order issued")).toBe(`${p}?registrar_order=true#list`);
    expect(tileHref("Registrar order not yet")).toBe(`${p}?registrar_order=false#list`);
    expect(tileHref("Orientation conducted")).toBe(`${p}?orientation=true#list`);
    expect(tileHref("Orientation not yet")).toBe(`${p}?orientation=false#list`);
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
    expect(within(table).getByText("ID card: Collected")).toBeInTheDocument();
    expect(within(table).getByText("Arms: Created")).toBeInTheDocument();
    expect(within(table).getByText("Food app")).toBeInTheDocument();
    expect(within(table).getByText("A-101")).toBeInTheDocument();
  });

  it("shows the effective (app) value in the row, labelled as an app mark", async () => {
    mockedList.mockResolvedValue({
      items: [
        order({
          outcome: null,
          items: orderItems(
            { room_allotted: { sheet: "A-101" } },
            {
              outcome: { effective: "LEFT", app: "LEFT", source: "app", marked_by: "Priya HR", marked_at: "2026-10-30T05:00:00Z" },
              room_allotted: { effective: "B-7", app: "B-7", source: "app", marked_by: "Priya HR" },
            },
          ),
        }),
      ],
      total: 1,
      limit: 25,
      offset: 0,
    });
    renderPage();
    const table = await screen.findByTestId("order-table");
    expect(await within(table).findByText("Left (app)")).toBeInTheDocument();
    expect(within(table).getByText("B-7")).toBeInTheDocument();
    expect(within(table).queryByText("A-101")).not.toBeInTheDocument();
  });

  it("passes the registrar order and orientation filters through", async () => {
    renderPage("/provisional-orders?registrar_order=false&orientation=true");
    const line = await screen.findByTestId("joining-active-filters");
    expect(line).toHaveTextContent("Registrar order not yet issued · Orientation conducted");
    expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ registrar_order: false, orientation: true }));
  });

  it("a marker opens a row, edits the checklist and saves only what changed", async () => {
    const user = userEvent.setup();
    const saved = order({
      items: orderItems(
        { arms_done: { sheet: true, raw: "Done" } },
        { id_card_done: { effective: false, sheet: true, sheet_raw: "Yes", app: false, source: "app", marked_by: "Signed In", marked_at: "2026-10-31T06:00:00Z" } },
      ),
    });
    mockedMark.mockResolvedValue(saved);
    renderPage();
    const table = await screen.findByTestId("order-table");
    await user.click(await within(table).findByText("Anitha R"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText("From the sheet").length).toBeGreaterThan(0);
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    const idCard = within(dialog).getByRole("group", { name: "ID Card" });
    expect(within(idCard).getByLabelText("Use sheet value (Collected)")).toBeChecked();
    await user.click(within(idCard).getByLabelText("Not collected"));
    await user.type(within(dialog).getByLabelText("Room allotted"), "B-7");
    const registrar = within(dialog).getByRole("group", { name: "Final appointment order from the Registrar's office" });
    await user.click(within(registrar).getByLabelText("Issued"));
    await user.type(within(dialog).getByLabelText("Final appointment order from the Registrar's office date"), "2026-10-29");
    await user.click(save);

    await waitFor(() =>
      expect(mockedMark).toHaveBeenCalledWith("o-1", {
        id_card_done: false,
        room_allotted: "B-7",
        registrar_order_issued: true,
        registrar_order_date: "2026-10-29",
      }),
    );
    // The list and summary refetch, and the sheet shows the saved marks.
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2));
    expect(mockedSummary).toHaveBeenCalledTimes(2);
    expect(await within(dialog).findByText(/Marked in app by Signed In/)).toBeInTheDocument();
  });

  it("choosing 'Use sheet value' sends null to clear an app mark", async () => {
    const user = userEvent.setup();
    mockedList.mockResolvedValue({
      items: [order({ items: orderItems({ order_status: { sheet: "ISSUED", raw: "Issued" } }, { order_status: { effective: "PENDING", app: "PENDING", source: "app", marked_by: "Priya HR" } }) })],
      total: 1,
      limit: 25,
      offset: 0,
    });
    mockedMark.mockResolvedValue(order());
    renderPage();
    await user.click(await within(await screen.findByTestId("order-table")).findByText("Anitha R"));
    const dialog = await screen.findByRole("dialog");
    const status = within(dialog).getByRole("group", { name: "Provision order" });
    expect(within(status).getByLabelText("Pending")).toBeChecked();
    await user.click(within(status).getByLabelText("Use sheet value (Issued)"));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockedMark).toHaveBeenCalledWith("o-1", { order_status: null }));
  });

  it("other roles see the items read-only, with the app-mark note", async () => {
    signInAs("MANAGEMENT");
    const user = userEvent.setup();
    mockedList.mockResolvedValue({
      items: [
        order({
          items: orderItems(
            { id_card_done: { sheet: true, raw: "Yes" } },
            {
              orientation_conducted: { effective: true, app: true, source: "app", marked_by: "Priya HR", marked_at: "2026-10-30T05:00:00Z" },
              orientation_date: { effective: "2026-10-28", app: "2026-10-28", source: "app", marked_by: "Priya HR" },
            },
          ),
        }),
      ],
      total: 1,
      limit: 25,
      offset: 0,
    });
    renderPage();
    await user.click(await within(await screen.findByTestId("order-table")).findByText("Anitha R"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Conducted, 28 Oct 2026")).toBeInTheDocument();
    expect(within(dialog).getByText(/Marked in app by Priya HR, 30 Oct 2026/)).toBeInTheDocument();
    expect(within(dialog).getByText("Collected")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();
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
