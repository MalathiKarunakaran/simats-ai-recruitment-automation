import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import { getVacancyRequest } from "@/api/vacancyRequests";
import { VacancyRequestForm } from "@/components/vacancy-requests/VacancyRequestForm";

export function VacancyRequestEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: vr, isLoading } = useQuery({
    queryKey: ["vacancy-request", id],
    queryFn: () => getVacancyRequest(id!),
    enabled: Boolean(id),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (!vr) {
    return <Navigate to="/vacancy-requests" replace />;
  }
  if (vr.status !== "DRAFT") {
    return <Navigate to={`/vacancy-requests/${vr.id}`} replace />;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Edit vacancy request</h1>
      <VacancyRequestForm
        mode="edit"
        initialValues={vr}
        onSuccess={(result) => navigate(`/vacancy-requests/${result.id}`)}
      />
    </div>
  );
}
