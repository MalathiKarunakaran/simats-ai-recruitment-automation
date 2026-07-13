import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

import type { CampusCode } from "@/api/types";

interface CampusContextValue {
  // null = "no narrowing" -- only meaningful for global-scope roles (an "all
  // campuses" view). Single-campus roles' API calls ignore this value
  // server-side regardless (see app/services/scoping.py::resolve_campus_filter),
  // so it's simply never set for them.
  selectedCampusCode: CampusCode | null;
  setSelectedCampusCode: (code: CampusCode | null) => void;
}

const CampusContext = createContext<CampusContextValue | null>(null);

export function CampusProvider({ children }: { children: ReactNode }) {
  const [selectedCampusCode, setSelectedCampusCode] = useState<CampusCode | null>(null);
  return (
    <CampusContext.Provider value={{ selectedCampusCode, setSelectedCampusCode }}>
      {children}
    </CampusContext.Provider>
  );
}

export function useCampus(): CampusContextValue {
  const context = useContext(CampusContext);
  if (!context) throw new Error("useCampus must be used within a CampusProvider");
  return context;
}
