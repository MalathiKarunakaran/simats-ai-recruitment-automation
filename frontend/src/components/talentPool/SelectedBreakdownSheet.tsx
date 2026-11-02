import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { getSelectedBreakdown } from "@/api/talentPool";
import type { SelectedBreakdownDimension, TalentPoolSourceTab } from "@/api/types";
import { BreakdownList } from "@/components/talentPool/BreakdownList";
import { filterHref, type MeaningParam } from "@/components/talentPool/filterHref";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * Opens from the Selected tile: who the selected candidates are, by department,
 * college, state, country and gender. These columns are often unfilled in the
 * sheets, so every card says how many rows it covers rather than letting a
 * handful of values pass for the whole picture. Clicking a bar lists those
 * candidates in the register.
 */

interface SelectedBreakdownSheetProps {
  open: boolean;
  tab: TalentPoolSourceTab;
  deptMode: "group" | "raw";
  currentParams: URLSearchParams;
  onClose: () => void;
}

export function SelectedBreakdownSheet({ open, tab, deptMode, currentParams, onClose }: SelectedBreakdownSheetProps) {
  const includeInactive = currentParams.get("include_inactive") === "true";
  const query = useQuery({
    queryKey: ["talent-pool", "selected-breakdown", tab, deptMode, includeInactive],
    queryFn: () => getSelectedBreakdown(tab, deptMode, includeInactive),
    enabled: open,
  });
  const data = query.data;
  const sheetName = tab === "NTS" ? "NTS sheet" : "Final sheet";

  // The panel counts every Selected candidate, so a bar's list must not stay
  // narrowed by a department or search chosen earlier on the page.
  const barParams = new URLSearchParams(currentParams);
  barParams.delete("department");
  barParams.delete("q");

  const card = (title: string, column: string, dimension: SelectedBreakdownDimension, param: MeaningParam | "department") => (
    <BreakdownList
      title={title}
      items={dimension.items}
      subLine={`Recorded for ${dimension.recorded} of ${data?.total ?? 0}`}
      emptyMessage={`Not recorded yet. Fill the ${column} column in the ${sheetName}.`}
      hrefFor={(label) => {
        if (param !== "department") return filterHref(tab, { status: "Selected", [param]: label }, barParams);
        const params = new URLSearchParams(barParams);
        params.set("department", label);
        return filterHref(tab, { status: "Selected" }, params);
      }}
    />
  );

  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Selected candidates{data ? `: ${data.total}` : ""}</SheetTitle>
          <SheetDescription>From the {sheetName}. Click a bar to see those candidates.</SheetDescription>
        </SheetHeader>
        <SheetBody className="gap-5">
          {query.isError ? (
            <div className="space-y-2">
              <p className="text-xs text-brand-danger">
                {query.error instanceof Error ? query.error.message : "Could not load the breakdown"}
              </p>
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                Retry
              </Button>
            </div>
          ) : !data ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading...
            </p>
          ) : (
            <>
              {card("Male / Female", "Gender", data.gender, "gender")}
              {card("College", "College", data.college, "college")}
              {card("Country", "Country", data.country, "country")}
              {card("State", "State", data.state, "state")}
              {card("Department", tab === "NTS" ? "Department" : "Actual Dept", data.department, "department")}
            </>
          )}
          <Button asChild variant="outline" size="sm">
            <Link to={filterHref(tab, { status: "Selected" }, currentParams)}>See full list</Link>
          </Button>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
