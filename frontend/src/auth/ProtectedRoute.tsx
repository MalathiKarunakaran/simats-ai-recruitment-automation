import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "@/auth/AuthContext";
import { NotPermittedPage } from "@/pages/NotPermittedPage";

const SET_NEW_PASSWORD_PATH = "/set-new-password";

export function ProtectedRoute() {
  const { user, isLoading, mustChangePassword } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // This app has no candidate-facing screens (Module 5 candidate portal is
  // deferred) -- every other role reaches the shell below.
  if (user.role === "CANDIDATE") {
    return <NotPermittedPage />;
  }

  // Backend forces this user to set a new password (admin reset, or the
  // flag got set mid-session -- see client.ts's onPasswordChangeRequired).
  // Every route except /set-new-password itself is blocked until they do,
  // mirroring the backend's own 403 PASSWORD_CHANGE_REQUIRED allow-list.
  if (mustChangePassword && location.pathname !== SET_NEW_PASSWORD_PATH) {
    return <Navigate to={SET_NEW_PASSWORD_PATH} replace />;
  }

  return <Outlet />;
}
