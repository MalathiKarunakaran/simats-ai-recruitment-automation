import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as departmentsApi from "@/api/departments";
import * as employeesApi from "@/api/employees";
import * as joiningApi from "@/api/joining";
import * as locationsApi from "@/api/locations";
import type {
  AppointmentOrderRead,
  ApplicationRead,
  DepartmentOptionsResponse,
  DepartmentRead,
  EmployeeRead,
  JoiningDocumentRead,
  JoiningRecordRead,
  UserRead,
} from "@/api/types";
import * as authContext from "@/auth/AuthContext";
import { JoiningCard } from "@/components/joining/JoiningCard";

vi.mock("@/api/joining");
vi.mock("@/api/employees");
vi.mock("@/api/departments");
vi.mock("@/api/locations");
vi.mock("@/auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/auth/AuthContext")>("@/auth/AuthContext");
  return { ...actual, useAuth: vi.fn() };
});

const mockedUseAuth = vi.mocked(authContext.useAuth);
const mockedGetJoiningRecord = vi.mocked(joiningApi.getJoiningRecord);
const mockedListJoiningDocuments = vi.mocked(joiningApi.listJoiningDocuments);
const mockedListEmployees = vi.mocked(employeesApi.listEmployees);
const mockedListDepartments = vi.mocked(departmentsApi.listDepartments);
const mockedListLocations = vi.mocked(locationsApi.listLocations);
const mockedHandOverToHod = vi.mocked(joiningApi.handOverToHod);
const mockedGetProvisionalOrder = vi.mocked(joiningApi.getProvisionalOrder);
const mockedGetDepartmentOptions = vi.mocked(joiningApi.getDepartmentOptions);

const ORDER: AppointmentOrderRead = {
  id: "ord-1",
  application_id: "app-1",
  order_number: "SSE / PA/ 231/ 10/ 2026",
  sequence: 231,
  order_date: "2026-10-31",
  status: "ISSUED",
  issued_by_id: "u-1",
  issued_at: "2026-10-31T05:00:00Z",
  candidate_name: "Jane Doe",
  designation: "Assistant Professor",
  category: "TEACHING",
  campus_code: "SSE",
  college_name: "SIMATS Engineering",
  principal_name: "Dr. B. Ramesh",
  department_name: "Computer Science",
  joining_date: "2026-11-02",
  probation_end_date: "2027-01-31",
  signed_copy_content_type: null,
  signed_copy_size: null,
  signed_copy_uploaded_at: null,
};

const OPTIONS: DepartmentOptionsResponse = {
  designation_id: "des-1",
  suggestion_basis: "RESUME_QUALIFICATION",
  suggestion_text: "M.E. Computer Science",
  options: [
    {
      department_id: "dept-cse",
      department_name: "Computer Science",
      sanctioned: 3,
      working: 1,
      reserved: 0,
      vacancy: 2,
      suggested: true,
    },
    {
      department_id: "dept-civil",
      department_name: "Civil Engineering",
      sanctioned: 1,
      working: 0,
      reserved: 1,
      vacancy: 0,
      suggested: false,
    },
  ],
};

function makeApplication(overrides: Partial<ApplicationRead> = {}): ApplicationRead {
  return {
    id: "app-1",
    candidate_id: "cand-1",
    job_posting_id: "jp-1",
    campus_id: "c-sse",
    role_category: "TEACHING",
    status: "JOINING_CONFIRMED",
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
    hod_assigned: null,
    qualification_mismatch: false,
    qualification_mismatch_reason: null,
    created_at: "2026-01-02T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

const RECORD: JoiningRecordRead = {
  id: "jr-1",
  application_id: "app-1",
  joining_date: "2026-03-01",
  actual_joining_date: null,
  onboarding_completed_at: null,
  onboarding_completed_by_id: null,
  created_at: "2026-01-02T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

const DEPARTMENT: DepartmentRead = {
  id: "dept-1",
  campus_id: "c-sse",
  name: "Computer Science",
  code: null,
  supported_categories: [],
  parent_group: null,
  description: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function makeDocument(overrides: Partial<JoiningDocumentRead> = {}): JoiningDocumentRead {
  return {
    id: "doc-1",
    application_id: "app-1",
    document_type: "PAN",
    status: "PENDING",
    storage_key: null,
    received_at: null,
    notes: null,
    created_at: "2026-01-02T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function renderCard(application: ApplicationRead) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <JoiningCard application={application} />
    </QueryClientProvider>,
  );
}

describe("JoiningCard", () => {
  beforeEach(() => {
    mockedListDepartments.mockResolvedValue([DEPARTMENT]);
    mockedGetProvisionalOrder.mockReset();
    mockedGetProvisionalOrder.mockResolvedValue(ORDER);
    mockedGetDepartmentOptions.mockResolvedValue(OPTIONS);
  });

  it("renders nothing for a role outside the read roles", () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });

    const { container } = renderCard(makeApplication());
    expect(container).toBeEmptyDOMElement();
  });

  // RBAC permission-gate audit (2026-08-24): every joining.py endpoint
  // (reads and writes alike) is gated by require_permission(ONBOARDING),
  // not READ_ROLES/HR_ONLY_ROLES alone -- these two lock in the fix without
  // changing the test above (no grant passed there, so it behaves exactly
  // as before).
  it("shows the card to a role outside READ_ROLES individually granted ONBOARDING", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "CAMPUS_HOD" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
      hasPermission: (permission) => permission === "ONBOARDING",
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument()]);

    renderCard(makeApplication({ status: "JOINING_CONFIRMED" }));

    await waitFor(() => expect(screen.getByText("Mark joined")).toBeInTheDocument());
    // canWrite is also unlocked by the same ONBOARDING grant -- the document
    // toggle (an HR_ONLY_ROLES-gated write action) is visible too.
    await waitFor(() => expect(screen.getByText("Mark received")).toBeInTheDocument());
  });

  it("shows Mark joined for Recruitment Officer but not the document toggle", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "RECRUITMENT_OFFICER" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument()]);

    renderCard(makeApplication({ status: "JOINING_CONFIRMED" }));

    await waitFor(() => expect(screen.getByText("Mark joined")).toBeInTheDocument());
    expect(screen.queryByText("Mark received")).not.toBeInTheDocument();
  });

  it("shows the document toggle for HR Admin", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument()]);

    renderCard(makeApplication({ status: "JOINING_CONFIRMED" }));

    await waitFor(() => expect(screen.getByText("Mark received")).toBeInTheDocument());
  });

  it("uploads a document file and shows View once one is stored", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    const stored = makeDocument({ status: "RECEIVED", storage_key: "app-1/PAN/pan.pdf" });
    // Pending on the first read; the refetch after the upload sees the stored file.
    mockedListJoiningDocuments.mockResolvedValue([stored]);
    mockedListJoiningDocuments.mockResolvedValueOnce([makeDocument()]);
    const mockedUpload = vi.mocked(joiningApi.uploadJoiningDocumentFile);
    mockedUpload.mockResolvedValue(stored);

    renderCard(makeApplication({ status: "JOINING_CONFIRMED" }));
    await waitFor(() => expect(screen.getByText("Upload")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "View PAN" })).not.toBeInTheDocument();

    const file = new File(["%PDF-1.4"], "pan.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Upload PAN"), file);

    await waitFor(() => expect(mockedUpload).toHaveBeenCalledWith("doc-1", file));
    await waitFor(() => expect(screen.getByRole("button", { name: "View PAN" })).toBeInTheDocument());
    expect(screen.getByText("Replace file")).toBeInTheDocument();
  });

  it("opens the stored file when View is clicked", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "RECRUITMENT_OFFICER" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument({ status: "RECEIVED", storage_key: "app-1/PAN/pan.pdf" })]);
    const mockedOpen = vi.mocked(joiningApi.openJoiningDocumentFile);
    mockedOpen.mockResolvedValue(undefined);

    renderCard(makeApplication({ status: "JOINING_CONFIRMED" }));

    await userEvent.click(await screen.findByRole("button", { name: "View PAN" }));
    expect(mockedOpen).toHaveBeenCalledWith("doc-1");
  });

  const authAs = (role: UserRead["role"]) =>
    mockedUseAuth.mockReturnValue({
      user: { role } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });

  it("offers Issue provisional order at JOINED instead of the department picker", async () => {
    authAs("HR_ADMIN");
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument({ status: "RECEIVED" })]);
    const mockedIssue = vi.mocked(joiningApi.issueProvisionalOrder);
    mockedIssue.mockResolvedValue(ORDER);

    renderCard(makeApplication({ status: "JOINED" }));

    await userEvent.click(await screen.findByRole("button", { name: "Issue provisional order" }));
    expect(mockedIssue).toHaveBeenCalledWith("app-1");
    expect(screen.queryByText("Confirm department & room allotment")).not.toBeInTheDocument();
    expect(mockedGetDepartmentOptions).not.toHaveBeenCalled();
  });

  it("shows the order with Download letter and Upload signed copy once issued", async () => {
    authAs("HR_ADMIN");
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument({ status: "RECEIVED" })]);
    const mockedOpenLetter = vi.mocked(joiningApi.openProvisionalOrderLetter);
    mockedOpenLetter.mockResolvedValue(undefined);
    const mockedUploadSigned = vi.mocked(joiningApi.uploadProvisionalOrderSignedCopy);
    mockedUploadSigned.mockResolvedValue({ ...ORDER, signed_copy_uploaded_at: "2026-10-31T06:00:00Z" });

    renderCard(makeApplication({ status: "PROVISIONAL_ORDER_ISSUED" }));

    expect(await screen.findByText("SSE / PA/ 231/ 10/ 2026")).toBeInTheDocument();
    expect(screen.getByText("31-10-2026")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Download letter" }));
    expect(mockedOpenLetter).toHaveBeenCalledWith("app-1");

    const file = new File(["%PDF-1.4"], "signed.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Upload signed copy"), file);
    await waitFor(() => expect(mockedUploadSigned).toHaveBeenCalledWith("app-1", file));
  });

  it("lists departments with vacancy, suggested first, and disables a full one", async () => {
    authAs("HR_ADMIN");
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument({ status: "RECEIVED" })]);
    const mockedAllot = vi.mocked(joiningApi.allotDepartmentRoom);
    mockedAllot.mockResolvedValue(RECORD);

    renderCard(makeApplication({ status: "PROVISIONAL_ORDER_ISSUED" }));

    const radios = await screen.findAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0]).toHaveAccessibleName(/Computer Science/);
    expect(screen.getByText("Suggested")).toBeInTheDocument();
    expect(screen.getByText(/2 vacant/)).toBeInTheDocument();
    expect(screen.getByText(/reserved 1/)).toBeInTheDocument();
    expect(radios[1]).toBeDisabled();

    const confirm = screen.getByText("Confirm department & room allotment");
    expect(confirm).toBeDisabled();
    await userEvent.click(radios[0]);
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(mockedAllot).toHaveBeenCalledWith("app-1", { department_id: "dept-cse", room_allotted: null }),
    );
  });

  it("disables the allotment confirm button while a document is still pending", async () => {
    authAs("HR_ADMIN");
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument({ status: "PENDING" })]);

    renderCard(makeApplication({ status: "PROVISIONAL_ORDER_ISSUED" }));

    await userEvent.click((await screen.findAllByRole("radio"))[0]);
    expect(screen.getByText("Confirm department & room allotment")).toBeDisabled();
    expect(screen.getByText("All documents must be received first.")).toBeInTheDocument();
  });

  it("lets a Super Admin pick a full department only with a reason", async () => {
    authAs("SUPER_ADMIN");
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument({ status: "RECEIVED" })]);
    const mockedAllot = vi.mocked(joiningApi.allotDepartmentRoom);
    mockedAllot.mockReset();
    mockedAllot.mockResolvedValue(RECORD);

    renderCard(makeApplication({ status: "PROVISIONAL_ORDER_ISSUED" }));

    const radios = await screen.findAllByRole("radio");
    expect(radios[1]).toBeEnabled();
    await userEvent.click(radios[1]);
    const confirm = screen.getByText("Confirm department & room allotment");
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Override reason (Super Admin)"), "Principal asked");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(mockedAllot).toHaveBeenCalledWith("app-1", {
        department_id: "dept-civil",
        room_allotted: null,
        override_reason: "Principal asked",
      }),
    );
  });

  it("shows the orientation date input at DEPARTMENT_ROOM_ALLOTTED", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument({ status: "RECEIVED" })]);

    renderCard(makeApplication({ status: "DEPARTMENT_ROOM_ALLOTTED" }));

    await waitFor(() => expect(screen.getByText("Mark orientation complete")).toBeInTheDocument());
  });

  it("requires HOD assigned before enabling Hand over to HOD at ORIENTATION_COMPLETE", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument({ status: "RECEIVED" })]);

    renderCard(makeApplication({ status: "ORIENTATION_COMPLETE" }));

    await waitFor(() => expect(screen.getByText("Hand over to HOD")).toBeInTheDocument());
    expect(screen.getByText("Hand over to HOD")).toBeDisabled();
  });

  it("shows employee fields inline once HANDED_OVER_TO_HOD", async () => {
    mockedUseAuth.mockReturnValue({
      user: { role: "HR_ADMIN" } as UserRead,
      isLoading: false,
      login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
      logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
    });
    mockedGetJoiningRecord.mockResolvedValue(RECORD);
    mockedListJoiningDocuments.mockResolvedValue([makeDocument({ status: "RECEIVED" })]);
    mockedListEmployees.mockResolvedValue([
      {
        id: "emp-1",
        application_id: "app-1",
        designation_id: null,
        employee_code: "SSE-0001",
        campus_id: "c-sse",
        department_id: "dept-1",
        full_name: "Jane Doe",
        email: "jane@example.com",
        phone_number: null,
        designation: "Assistant Professor",
        date_of_joining: "2026-03-01",
        user_id: null,
        employment_status: "ACTIVE",
        separation_date: null,
        separation_reason: null,
        separated_by_id: null,
        created_at: "2026-01-02T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
      } satisfies EmployeeRead,
    ]);

    renderCard(
      makeApplication({
        status: "HANDED_OVER_TO_HOD",
        room_allotted: "R-305",
        hod_assigned: "Dr. Test HOD",
      }),
    );

    await waitFor(() => expect(screen.getByText("SSE-0001")).toBeInTheDocument());
    expect(screen.getByText("R-305")).toBeInTheDocument();
    expect(screen.getByText("Dr. Test HOD")).toBeInTheDocument();
  });
  describe("Housekeeping hand-over adds the hire to the roster", () => {
    const hrAuth = () =>
      mockedUseAuth.mockReturnValue({
        user: { role: "HR_ADMIN" } as UserRead,
        isLoading: false,
        login: vi.fn(), requestOtp: vi.fn(), loginWithOtp: vi.fn(),
        logout: vi.fn(), mustChangePassword: false, completePasswordChange: vi.fn(),
      });

    beforeEach(() => {
      mockedGetJoiningRecord.mockResolvedValue(RECORD);
      mockedListJoiningDocuments.mockResolvedValue([makeDocument({ status: "RECEIVED" })]);
      mockedListLocations.mockResolvedValue([
        {
          id: "loc-1",
          campus_id: "c-sse",
          name: "Main Block",
          block_building: "Main Block",
          floor_venue: "Ground Floor",
          category: null,
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "loc-other",
          campus_id: "c-scad",
          name: "Elsewhere",
          block_building: null,
          floor_venue: null,
          category: null,
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ]);
    });

    it("does not ask a Teaching hire for roster details", async () => {
      hrAuth();
      renderCard(makeApplication({ status: "ORIENTATION_COMPLETE", role_category: "TEACHING" }));

      await waitFor(() => expect(screen.getByText("Hand over to HOD")).toBeInTheDocument());
      expect(screen.queryByLabelText("Bio ID")).not.toBeInTheDocument();
      expect(mockedListLocations).not.toHaveBeenCalled();
    });

    it("asks a Housekeeping hire for Bio ID, shift and location, and gates the button on them", async () => {
      hrAuth();
      const user = userEvent.setup();
      renderCard(makeApplication({ status: "ORIENTATION_COMPLETE", role_category: "HOUSEKEEPING" }));

      await waitFor(() => expect(screen.getByLabelText("Bio ID")).toBeInTheDocument());
      await user.type(screen.getByLabelText("HOD assigned"), "Mr. Supervisor");
      // HOD alone is not enough for Housekeeping.
      expect(screen.getByText("Hand over to HOD")).toBeDisabled();

      await user.type(screen.getByLabelText("Bio ID"), "BIO-7781");
      await user.click(screen.getByRole("combobox", { name: "Shift" }));
      await user.click(await screen.findByRole("option", { name: "Night" }));
      expect(screen.getByText("Hand over to HOD")).toBeDisabled();

      await user.click(screen.getByRole("combobox", { name: "Location" }));
      // Only this campus's locations are offered.
      expect(screen.queryByRole("option", { name: "Elsewhere" })).not.toBeInTheDocument();
      await user.click(await screen.findByRole("option", { name: "Main Block — Ground Floor" }));
      expect(screen.getByText("Hand over to HOD")).toBeEnabled();

      mockedHandOverToHod.mockResolvedValue({} as EmployeeRead);
      await user.click(screen.getByText("Hand over to HOD"));
      await waitFor(() => expect(mockedHandOverToHod).toHaveBeenCalledTimes(1));
      expect(mockedHandOverToHod).toHaveBeenCalledWith("app-1", {
        hod_assigned: "Mr. Supervisor",
        designation: null,
        bio_id: "BIO-7781",
        shift: "NIGHT",
        location_id: "loc-1",
        supervisor: null,
      });
    });
  });
});
