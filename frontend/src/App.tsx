import { Navigate, Route, Routes } from "react-router-dom";

import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { AppShell } from "@/components/layout/AppShell";
import { ApplicationCreatePage } from "@/pages/ApplicationCreatePage";
import { ApplicationDetailPage } from "@/pages/ApplicationDetailPage";
import { ApplicationsListPage } from "@/pages/ApplicationsListPage";
import { CandidateCreatePage } from "@/pages/CandidateCreatePage";
import { CandidateDetailPage } from "@/pages/CandidateDetailPage";
import { CandidatesListPage } from "@/pages/CandidatesListPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { LoginPage } from "@/pages/LoginPage";
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
          <Route path="/vacancy-requests/new" element={<VacancyRequestCreatePage />} />
          <Route path="/vacancy-requests/:id" element={<VacancyRequestDetailPage />} />
          <Route path="/vacancy-requests/:id/edit" element={<VacancyRequestEditPage />} />
          <Route path="/candidates" element={<CandidatesListPage />} />
          <Route path="/candidates/new" element={<CandidateCreatePage />} />
          <Route path="/candidates/:id" element={<CandidateDetailPage />} />
          <Route path="/applications" element={<ApplicationsListPage />} />
          <Route path="/applications/new" element={<ApplicationCreatePage />} />
          <Route path="/applications/:id" element={<ApplicationDetailPage />} />
        </Route>
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
