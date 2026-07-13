import { Navigate, Route, Routes } from "react-router-dom";

import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { AppShell } from "@/components/layout/AppShell";
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
        </Route>
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
