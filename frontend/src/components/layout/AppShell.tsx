import { Briefcase, LayoutDashboard, Users } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "@/auth/AuthContext";
import { CampusSwitcher } from "@/components/layout/CampusSwitcher";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, enabled: true },
  { to: "/vacancy-requests", label: "Vacancy Requests", icon: Briefcase, enabled: true },
  { to: "/candidates", label: "Candidates", icon: Users, enabled: true },
  { to: "/applications", label: "Applications", icon: Briefcase, enabled: true },
  { to: "/interviews", label: "Interviews", enabled: false },
  { to: "/offers", label: "Offers", enabled: false },
  { to: "/reports", label: "Reports", enabled: false },
];

export function AppShell({ children }: { children?: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-border p-4">
        <div className="mb-6 px-2 text-sm font-semibold">SIMATS Recruitment</div>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) =>
            item.enabled ? (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground",
                    isActive && "bg-accent text-accent-foreground font-medium",
                  )
                }
              >
                {item.icon ? <item.icon className="h-4 w-4" /> : null}
                {item.label}
              </NavLink>
            ) : (
              <span
                key={item.to}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-muted-foreground opacity-60"
              >
                {item.label}
                <span className="text-xs">soon</span>
              </span>
            ),
          )}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
          <CampusSwitcher />
          <div className="flex items-center gap-3">
            <div className="text-right text-sm">
              <div className="font-medium">{user?.full_name}</div>
              <div className="text-xs text-muted-foreground">{user?.role.replace(/_/g, " ")}</div>
            </div>
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </header>

        <main className="flex-1 p-6">{children ?? <Outlet />}</main>
      </div>
    </div>
  );
}
