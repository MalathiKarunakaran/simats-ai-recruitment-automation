import { BarChart3, Briefcase, CalendarClock, FileCheck, IdCard, LayoutDashboard, Users, UserCog } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";

import simatsSeal from "@/assets/simats-seal.png";
import { useAuth } from "@/auth/AuthContext";
import { CampusSwitcher } from "@/components/layout/CampusSwitcher";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon?: typeof LayoutDashboard;
  enabled: boolean;
  /** Roles that may see this link at all; undefined means every staff role. */
  visibleForRoles?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, enabled: true },
  { to: "/vacancy-requests", label: "Vacancy Requests", icon: Briefcase, enabled: true },
  { to: "/candidates", label: "Candidates", icon: Users, enabled: true },
  { to: "/applications", label: "Applications", icon: Briefcase, enabled: true },
  { to: "/interviews", label: "Interviews", icon: CalendarClock, enabled: true },
  {
    to: "/offers",
    label: "Offers",
    icon: FileCheck,
    enabled: true,
    // Offers visibility mirrors the backend's own gate on GET /offers
    // (offers.py: HR_ADMIN/SUPER_ADMIN/MANAGEMENT only) -- other staff
    // roles would just hit a 403, so the nav link is hidden for them.
    visibleForRoles: ["HR_ADMIN", "SUPER_ADMIN", "MANAGEMENT"],
  },
  { to: "/reports", label: "Reports", icon: BarChart3, enabled: true },
  { to: "/employees", label: "Employees", icon: IdCard, enabled: true },
  {
    to: "/users",
    label: "Users",
    icon: UserCog,
    enabled: true,
    // Mirrors app/models/enums.py::USER_MANAGEMENT_ROLES -- only these roles
    // can actually create/edit users, so only they see the nav link.
    visibleForRoles: ["SUPER_ADMIN", "HR_ADMIN"],
  },
];

export function AppShell({ children }: { children?: ReactNode }) {
  const { user, logout } = useAuth();

  const visibleNavItems = NAV_ITEMS.filter(
    (item) => !item.visibleForRoles || (user && item.visibleForRoles.includes(user.role)),
  );

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
        <div className="gear-edge" />
        <div className="flex items-center gap-2.5 px-4 py-4">
          <img src={simatsSeal} alt="SIMATS" className="h-9 w-9 shrink-0 object-contain" />
          <div className="leading-tight">
            <div className="font-display text-sm font-bold tracking-tight">SIMATS</div>
            <div className="text-[11px] text-muted-foreground">Recruitment</div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 px-3 pb-4">
          {visibleNavItems.map((item) =>
            item.enabled ? (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground/75 transition-colors hover:bg-accent hover:text-accent-foreground",
                    isActive && "bg-primary text-primary-foreground font-medium shadow-sm hover:bg-primary hover:text-primary-foreground",
                  )
                }
              >
                {item.icon ? <item.icon className="h-4 w-4 shrink-0" /> : null}
                {item.label}
              </NavLink>
            ) : (
              <span
                key={item.to}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-muted-foreground opacity-60"
              >
                {item.label}
                <span className="text-xs">soon</span>
              </span>
            ),
          )}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-card/80 px-6 py-3 backdrop-blur">
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
