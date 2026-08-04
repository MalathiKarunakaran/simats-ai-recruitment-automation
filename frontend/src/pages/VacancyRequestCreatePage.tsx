import { useNavigate } from "react-router-dom";

import { useAuth } from "@/auth/AuthContext";
import { VacancyRequestWizard } from "@/components/vacancy-requests/VacancyRequestWizard";

const CAN_CREATE_ROLES = ["CAMPUS_HOD", "SUPER_ADMIN"];

export function VacancyRequestCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!user || !CAN_CREATE_ROLES.includes(user.role)) {
    return (
      <p className="text-sm text-muted-foreground">
        Only a Campus HOD or Super Admin can raise a new vacancy request.
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
