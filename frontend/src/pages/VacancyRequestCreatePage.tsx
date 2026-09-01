import { useNavigate } from "react-router-dom";

import { useAuth } from "@/auth/AuthContext";
import { VacancyRequestWizard } from "@/components/vacancy-requests/VacancyRequestWizard";

const CAN_CREATE_ROLES = ["CAMPUS_HOD", "SUPER_ADMIN"];

export function VacancyRequestCreatePage() {
  const { user, hasPermission } = useAuth();
  const navigate = useNavigate();

  // Mirrors the backend's _can_create: the two historical roles OR an
  // individually granted CREATE_VACANCY_REQUEST.
  const canCreate =
    user != null &&
    (CAN_CREATE_ROLES.includes(user.role) || (hasPermission?.("CREATE_VACANCY_REQUEST") ?? false));

  if (!canCreate) {
    return (
      <p className="text-sm text-muted-foreground">
        You do not have permission to raise a new vacancy request.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">New vacancy request</h1>
      <VacancyRequestWizard onSuccess={(result) => navigate(`/vacancy-requests/${result.id}`)} />
    </div>
  );
}
