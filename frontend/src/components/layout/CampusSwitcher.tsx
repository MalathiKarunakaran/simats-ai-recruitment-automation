import { useQuery } from "@tanstack/react-query";

import { listCampuses } from "@/api/campuses";
import { GLOBAL_SCOPE_ROLES } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { useCampus } from "@/campus/CampusContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function CampusSwitcher() {
  const { user } = useAuth();
  const { selectedCampusCode, setSelectedCampusCode } = useCampus();
  const { data: campuses } = useQuery({ queryKey: ["campuses"], queryFn: listCampuses });

  const isGlobal = user && GLOBAL_SCOPE_ROLES.includes(user.role);

  if (!isGlobal) {
    const ownCampus = campuses?.find((c) => c.id === user?.campus_id);
    return (
      <span className="rounded-md border border-input bg-muted px-3 py-1.5 text-sm text-muted-foreground">
        {ownCampus ? `${ownCampus.code} · ${ownCampus.name}` : "Your campus"}
      </span>
    );
  }

  return (
    <Select
      value={selectedCampusCode ?? "ALL"}
      onValueChange={(value) => setSelectedCampusCode(value === "ALL" ? null : (value as typeof selectedCampusCode))}
    >
      <SelectTrigger className="w-48">
        <SelectValue placeholder="All campuses" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ALL">All campuses</SelectItem>
        {campuses?.map((campus) => (
          <SelectItem key={campus.id} value={campus.code}>
            {campus.code} · {campus.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
