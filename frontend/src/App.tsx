import { Navigate, Route, Routes } from "react-router-dom";

import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { AppShell } from "@/components/layout/AppShell";
import { ActivityLogPage } from "@/pages/ActivityLogPage";
import { ApplicationCreatePage } from "@/pages/ApplicationCreatePage";
import { ApplicationDetailPage } from "@/pages/ApplicationDetailPage";
import { ApplicationsListPage } from "@/pages/ApplicationsListPage";
import { CandidateCreatePage } from "@/pages/CandidateCreatePage";
import { CandidateDetailPage } from "@/pages/CandidateDetailPage";
import { CandidatesListPage } from "@/pages/CandidatesListPage";
import { CampusesPage } from "@/pages/CampusesPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { DesignationsPage } from "@/pages/DesignationsPage";
import { EligibilityRulesPage } from "@/pages/EligibilityRulesPage";
import { EmployeeDetailPage } from "@/pages/EmployeeDetailPage";
import { EmployeesListPage } from "@/pages/EmployeesListPage";
import { InterviewCreatePage } from "@/pages/InterviewCreatePage";
import { InterviewDetailPage } from "@/pages/InterviewDetailPage";
import { InterviewsListPage } from "@/pages/InterviewsListPage";
import { JobPostingDetailPage } from "@/pages/JobPostingDetailPage";
import { JobPostingsListPage } from "@/pages/JobPostingsListPage";
import { LoginPage } from "@/pages/LoginPage";
import { OfferCreatePage } from "@/pages/OfferCreatePage";
import { OfferDetailPage } from "@/pages/OfferDetailPage";
import { OffersListPage } from "@/pages/OffersListPage";
import { OnboardingListPage } from "@/pages/OnboardingListPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TrackerImportPage } from "@/pages/TrackerImportPage";
import { UserCreatePage } from "@/pages/UserCreatePage";
import { UserDetailPage } from "@/pages/UserDetailPage";
import { UsersListPage } from "@/pages/UsersListPage";
import { VacancyApprovalsPage } from "@/pages/VacancyApprovalsPage";
import { VacancyImportPage } from "@/pages/VacancyImportPage";
import { VacancyRequestCreatePage } from "@/pages/VacancyRequestCreatePage";
import { VacancyRequestDetailPage } from "@/pages/VacancyRequestDetailPage";
import { VacancyRequestEditPage } from "@/pages/VacancyRequestEditPage";
import { VacancyRequestsListPage } from "@/pages/VacancyRequestsListPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/vacancy-requests" element={<VacancyRequestsListPage />} />
          <Route path="/vacancy-approvals" element={<VacancyApprovalsPage />} />
          <Route path="/vacancy-requests/import" element={<VacancyImportPage />} />
          <Route path="/vacancy-requests/new" element={<VacancyRequestCreatePage />} />
          <Route path="/vacancy-requests/:id" element={<VacancyRequestDetailPage />} />
          <Route path="/vacancy-requests/:id/edit" element={<VacancyRequestEditPage />} />
          <Route path="/candidates" element={<CandidatesListPage />} />
          <Route path="/candidates/new" element={<CandidateCreatePage />} />
          <Route path="/candidates/:id" element={<CandidateDetailPage />} />
          <Route path="/applications" element={<ApplicationsListPage />} />
          <Route path="/applications/new" element={<ApplicationCreatePage />} />
          <Route path="/applications/:id" element={<ApplicationDetailPage />} />
          <Route path="/interviews" element={<InterviewsListPage />} />
          <Route path="/interviews/new" element={<InterviewCreatePage />} />
          <Route path="/interviews/:id" element={<InterviewDetailPage />} />
          <Route path="/offers" element={<OffersListPage />} />
          <Route path="/offers/new" element={<OfferCreatePage />} />
          <Route path="/offers/:id" element={<OfferDetailPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/employees" element={<EmployeesListPage />} />
          <Route path="/employees/:id" element={<EmployeeDetailPage />} />
          <Route path="/job-postings" element={<JobPostingsListPage />} />
          <Route path="/job-postings/:id" element={<JobPostingDetailPage />} />
          <Route path="/onboarding" element={<OnboardingListPage />} />
          <Route path="/import-tracker" element={<TrackerImportPage />} />
          <Route path="/activity-log" element={<ActivityLogPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/users" element={<UsersListPage />} />
          <Route path="/users/new" element={<UserCreatePage />} />
          <Route path="/users/:id" element={<UserDetailPage />} />
          <Route path="/eligibility-rules" element={<EligibilityRulesPage />} />
          <Route path="/designations" element={<DesignationsPage />} />
          <Route path="/campuses" element={<CampusesPage />} />
        </Route>
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
