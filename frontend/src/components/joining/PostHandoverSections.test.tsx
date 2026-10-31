import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as joiningApi from "@/api/joining";
import type { ApplicationRead, HodReviewHistory, HodReviewRead, PermanentOrderRead } from "@/api/types";
import { HodReviewSection } from "@/components/joining/HodReviewSection";
import { PermanentOrderSection } from "@/components/joining/PermanentOrderSection";

vi.mock("@/api/joining");

const mockedListHodReviews = vi.mocked(joiningApi.listHodReviews);
const mockedRecordHodReview = vi.mocked(joiningApi.recordHodReview);
const mockedRecordPermanentOrder = vi.mocked(joiningApi.recordPermanentOrder);
const mockedGetPermanentOrder = vi.mocked(joiningApi.getPermanentOrder);

function makeApplication(overrides: Partial<ApplicationRead> = {}): ApplicationRead {
  return {
    id: "app-1",
    candidate_id: "cand-1",
    job_posting_id: "jp-1",
    campus_id: "c-sse",
    role_category: "TEACHING",
    status: "HANDED_OVER_TO_HOD",
    applied_at: "2026-01-02T00:00:00Z",
    recorded_by_id: "u-1",
    rejection_reason: null,
    rejected_at: null,
    rejection_category: null,
    rejected_at_stage: null,
    waitlist_rank: null,
    withdrawn_reason: null,
    withdrawn_at: null,
    panel_members: null,
    panel_result: null,
    panel_remarks: null,
    salary_fixed: null,
    called_date: null,
    interview_scheduled_date: null,
    offer_given_date: null,
    expected_joining_date: null,
    actual_joining_date: null,
    department_allotted_id: null,
    room_allotted: null,
    orientation_date: null,
    hod_assigned: "Dr. Test HOD",
    qualification_mismatch: false,
    qualification_mismatch_reason: null,
    created_at: "2026-01-02T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function makeReview(overrides: Partial<HodReviewRead> = {}): HodReviewRead {
  return {
    id: "rev-1",
    application_id: "app-1",
    hod_name: "Dr. Test HOD",
    review_date: "2026-10-20",
    recommendation: "EXTEND_PROBATION",
    new_probation_end_date: "2027-04-30",
    remarks: "Give it a term",
    file_content_type: null,
    file_size: null,
    recorded_by_id: "u-1",
    recorded_at: "2026-10-20T05:00:00Z",
    ...overrides,
  };
}

const EMPTY_HISTORY: HodReviewHistory = {
  items: [],
  probation_end_date: "2027-01-31",
  provisional_probation_end_date: "2027-01-31",
  hod_assigned: "Dr. Test HOD",
};

const ORDER: PermanentOrderRead = {
  id: "po-1",
  application_id: "app-1",
  registrar_ref_no: "SIMATS/REG/PO/2026/041",
  order_date: "2026-10-28",
  issued_to_faculty_on: "2026-10-30",
  file_content_type: null,
  file_size: null,
  file_uploaded_at: null,
  recorded_by_id: "u-1",
  recorded_at: "2026-10-30T05:00:00Z",
};

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HodReviewSection", () => {
  it("records a recommend review with the HOD prefilled from hand-over", async () => {
    mockedListHodReviews.mockResolvedValue(EMPTY_HISTORY);
    mockedRecordHodReview.mockResolvedValue(makeReview({ recommendation: "RECOMMEND_PERMANENT" }));
    const onChanged = vi.fn();

    renderWithClient(<HodReviewSection application={makeApplication()} canRecord onChanged={onChanged} />);

    await waitFor(() => expect(screen.getByLabelText("HOD name")).toHaveValue("Dr. Test HOD"));
    expect(screen.getByText("31-01-2027")).toBeInTheDocument();
    expect(screen.getByText("No HOD review recorded yet.")).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Record HOD review" });
    expect(submit).toBeDisabled(); // no recommendation picked yet

    await userEvent.click(screen.getByLabelText("Recommend for permanent"));
    await userEvent.type(screen.getByLabelText("Remarks (optional)"), "Ready");
    await userEvent.click(submit);

    await waitFor(() => expect(mockedRecordHodReview).toHaveBeenCalled());
    expect(mockedRecordHodReview.mock.calls[0][0]).toBe("app-1");
    expect(mockedRecordHodReview.mock.calls[0][1]).toMatchObject({
      hod_name: "Dr. Test HOD",
      recommendation: "RECOMMEND_PERMANENT",
      new_probation_end_date: null,
      remarks: "Ready",
      file: null,
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("asks for a new probation end date when extending", async () => {
    mockedListHodReviews.mockResolvedValue(EMPTY_HISTORY);
    mockedRecordHodReview.mockResolvedValue(makeReview());

    renderWithClient(<HodReviewSection application={makeApplication()} canRecord onChanged={vi.fn()} />);
    await screen.findByLabelText("HOD name");

    expect(screen.queryByLabelText("New probation end date")).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Extend probation"));
    const submit = screen.getByRole("button", { name: "Record HOD review" });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText("New probation end date"), "2027-04-30");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() =>
      expect(mockedRecordHodReview.mock.calls[0][1]).toMatchObject({
        recommendation: "EXTEND_PROBATION",
        new_probation_end_date: "2027-04-30",
      }),
    );
  });

  it("shows the history latest first with the extended probation end, and no form for a reader", async () => {
    mockedListHodReviews.mockResolvedValue({
      items: [
        makeReview({ id: "rev-2", recommendation: "NOT_RECOMMENDED", new_probation_end_date: null, remarks: "Weak" }),
        makeReview(),
      ],
      probation_end_date: "2027-04-30",
      provisional_probation_end_date: "2027-01-31",
      hod_assigned: "Dr. Test HOD",
    });

    renderWithClient(<HodReviewSection application={makeApplication()} canRecord={false} onChanged={vi.fn()} />);

    const history = await screen.findByRole("list", { name: "Review history" });
    const items = history.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Not recommended");
    expect(items[0]).toHaveTextContent("Latest");
    expect(items[1]).toHaveTextContent("New probation end 30-04-2027");
    expect(screen.getByText("(extended from 31-01-2027)", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record HOD review" })).not.toBeInTheDocument();
  });

  it("offers no form once the review is complete", async () => {
    mockedListHodReviews.mockResolvedValue({
      ...EMPTY_HISTORY,
      items: [makeReview({ recommendation: "RECOMMEND_PERMANENT", new_probation_end_date: null })],
    });

    renderWithClient(
      <HodReviewSection application={makeApplication({ status: "HOD_REVIEW_COMPLETE" })} canRecord onChanged={vi.fn()} />,
    );

    expect(await screen.findByText("Recommend for permanent")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record HOD review" })).not.toBeInTheDocument();
  });

  it("renders nothing before hand-over", () => {
    const { container } = renderWithClient(
      <HodReviewSection application={makeApplication({ status: "ORIENTATION_COMPLETE" })} canRecord onChanged={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(mockedListHodReviews).not.toHaveBeenCalled();
  });
});

describe("PermanentOrderSection", () => {
  it("records the Registrar's order at HOD_REVIEW_COMPLETE", async () => {
    mockedRecordPermanentOrder.mockResolvedValue(ORDER);
    const onChanged = vi.fn();
    renderWithClient(
      <PermanentOrderSection
        application={makeApplication({ status: "HOD_REVIEW_COMPLETE" })}
        canWrite
        onChanged={onChanged}
      />,
    );

    const submit = screen.getByRole("button", { name: "Record permanent order" });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Registrar ref. no."), "SIMATS/REG/PO/2026/041");
    await userEvent.type(screen.getByLabelText("Order date"), "2026-10-28");
    await userEvent.type(screen.getByLabelText("Issued to faculty on"), "2026-10-27");
    expect(screen.getByText("The issue date cannot be before the order date.")).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await userEvent.clear(screen.getByLabelText("Issued to faculty on"));
    await userEvent.type(screen.getByLabelText("Issued to faculty on"), "2026-10-30");
    await userEvent.click(submit);

    await waitFor(() =>
      expect(mockedRecordPermanentOrder).toHaveBeenCalledWith("app-1", {
        registrar_ref_no: "SIMATS/REG/PO/2026/041",
        order_date: "2026-10-28",
        issued_to_faculty_on: "2026-10-30",
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("is hidden from someone who cannot record it", () => {
    const { container } = renderWithClient(
      <PermanentOrderSection
        application={makeApplication({ status: "HOD_REVIEW_COMPLETE" })}
        canWrite={false}
        onChanged={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the recorded order and the upload once issued", async () => {
    mockedGetPermanentOrder.mockResolvedValue(ORDER);
    renderWithClient(
      <PermanentOrderSection
        application={makeApplication({ status: "PERMANENT_ORDER_ISSUED" })}
        canWrite
        onChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText("SIMATS/REG/PO/2026/041")).toBeInTheDocument();
    expect(screen.getByText("28-10-2026")).toBeInTheDocument();
    expect(screen.getByText("30-10-2026")).toBeInTheDocument();
    expect(screen.getByText("Not uploaded yet")).toBeInTheDocument();
    expect(screen.getByLabelText("Upload signed order")).toBeInTheDocument();
  });
});
