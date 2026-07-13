import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "@/auth/AuthContext";
import { NotPermittedPage } from "@/pages/NotPermittedPage";

export function ProtectedRoute() {
  const { user, isLoading } = useAuth();

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

  return <Outlet />;
}
