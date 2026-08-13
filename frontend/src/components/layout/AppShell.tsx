import {
  BarChart3,
  Briefcase,
  Building2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Contact,
  FileCheck,
  History,
  IdCard,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  MapPin,
  Newspaper,
  Plus,
  Settings,
  Upload,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";

import simatsSeal from "@/assets/simats-seal.png";
import { useAuth } from "@/auth/AuthContext";
import { CampusSwitcher } from "@/components/layout/CampusSwitcher";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Roles that may see this link at all; undefined means every staff role. */
  visibleForRoles?: string[];
}

interface NavGroup {
  label: string | null;
  items: NavItem[];
}

// Grouped per the design spec (Recruitment / Candidates / Interviews /
// Administration / Reports / Settings); Dashboard sits ungrouped above all
// sections as the app's landing point. Every visibleForRoles value below is
// unchanged from before this redesign -- only the grouping/visuals moved.
const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Recruitment",
    items: [
      {
        to: "/sanctioned-strength",
        label: "Sanctioned Strength",
        icon: ClipboardList,
        // Mirrors vacancy_register.py's own read gate (_staff_only) -- broad
        // read, same pattern as Eligibility Rules/Designations/Campuses/
        // Departments. Moved here from Administration (and renamed from
        // "Vacancy Register") per zany-snuggling-pie.md Phase C -- sits
        // directly above "Vacancy Requests" since it's the ceiling that
        // requests are made against.
      },
      { to: "/vacancy-requests", label: "Vacancy Requests", icon: Briefcase },
      {
        to: "/vacancy-approvals",
        label: "Vacancy Approvals",
        icon: ClipboardCheck,
        // Mirrors VacancyApprovalsPage's own ACTIONABLE_STATUSES_BY_ROLE --
        // only roles that actually take part in the approval chain see this.
        visibleForRoles: ["ASSOCIATE_DEAN_RECRUITMENT", "HR_ADMIN", "SUPER_ADMIN", "RECRUITMENT_COORDINATOR"],
      },
      { to: "/job-postings", label: "Job Postings", icon: Newspaper },
    ],
  },
  {
    label: "Candidates",
    items: [
      { to: "/candidates", label: "Candidates", icon: Users },
      { to: "/applications", label: "Applications", icon: Briefcase },
    ],
  },
  {
    label: "Interviews",
    items: [
      { to: "/interviews", label: "Interviews", icon: CalendarClock },
      {
        to: "/offers",
        label: "Offers",
        icon: FileCheck,
        // Mirrors offers.py: HR_ADMIN/SUPER_ADMIN/MANAGEMENT/RECRUITMENT_COORDINATOR only.
        visibleForRoles: ["HR_ADMIN", "SUPER_ADMIN", "MANAGEMENT", "RECRUITMENT_COORDINATOR"],
      },
      {
        to: "/onboarding",
        label: "Onboarding",
        icon: UserPlus,
        // Mirrors OnboardingListPage's own CAN_VIEW_ROLES.
        visibleForRoles: ["HR_ADMIN", "RECRUITMENT_OFFICER", "SUPER_ADMIN", "RECRUITMENT_COORDINATOR"],
      },
    ],
  },
  {
    label: "Administration",
    items: [
      { to: "/employees", label: "Employees", icon: IdCard },
      {
        to: "/import-tracker",
        label: "Import Data",
        icon: Upload,
        // Mirrors POST /migration/import-tracker-workbook (HR_ADMIN/SUPER_ADMIN only).
        visibleForRoles: ["HR_ADMIN", "SUPER_ADMIN"],
      },
      {
        to: "/users",
        label: "Users",
        icon: UserCog,
        // Mirrors app/models/enums.py::USER_MANAGEMENT_ROLES.
        visibleForRoles: ["SUPER_ADMIN", "HR_ADMIN"],
      },
      {
        to: "/eligibility-rules",
        label: "Eligibility Rules",
        icon: ListChecks,
        // Mirrors eligibility_rules.py's own read gate (_staff_only).
      },
      {
        to: "/designations",
        label: "Designations",
        icon: Contact,
        // Mirrors designations.py's own read gate (_staff_only) -- broad
        // read, same pattern as Eligibility Rules above; write controls
        // inside the page itself check DESIGNATION_WRITE_ROLES.
      },
      {
        to: "/campuses",
        label: "Campuses",
        icon: Building2,
        // Mirrors campuses.py's own read gate (any authenticated staff) --
        // broad read, same pattern as Designations/Eligibility Rules; write
        // controls inside the page itself check CAMPUS_WRITE_ROLES
        // (SUPER_ADMIN only, matching create_campus/update_campus exactly).
      },
      {
        to: "/departments",
        label: "Departments",
        icon: LayoutGrid,
        // Mirrors departments.py's own read gate (_staff_only, campus-scoped
        // for non-global roles) -- write controls inside the page itself
        // check DEPARTMENT_MANAGEMENT_ROLES (SUPER_ADMIN/HR_ADMIN). Replaces
        // the inline Campus/Department cards that used to live in Settings
        // -- now standalone pages, same as Designations always was.
      },
      {
        to: "/locations",
        label: "Locations",
        icon: MapPin,
        // Mirrors locations.py's own read gate (_staff_only, campus-scoped
        // for non-global roles) -- broad read, same pattern as Departments
        // above; write controls inside the page itself check
        // LOCATION_MANAGEMENT_ROLES (SUPER_ADMIN/HR_ADMIN/RECRUITMENT_OFFICER
        // -- broader than Department's own write set, plan decision 4).
        // glowing-zooming-hamming.md Phase B.
      },
      {
        to: "/activity-log",
        label: "Activity Log",
        icon: History,
        // Mirrors audit_logs.py::_READ_ROLES exactly.
        visibleForRoles: ["SUPER_ADMIN", "HR_ADMIN", "ASSOCIATE_DEAN_RECRUITMENT", "CAMPUS_HOD"],
      },
    ],
  },
  {
    label: "Reports",
    items: [{ to: "/reports", label: "Reports", icon: BarChart3 }],
  },
  {
    label: "Settings",
    items: [{ to: "/settings", label: "Settings", icon: Settings }],
  },
];

// A small set of the most common "create" destinations, surfaced from the
// navbar's Quick Actions button so a frequent action never needs a sidebar
// hunt. Deliberately short -- this is a shortcut, not a duplicate nav.
const QUICK_ACTIONS: { label: string; to: string; visibleForRoles?: string[] }[] = [
  { to: "/vacancy-requests/new", label: "New vacancy request" },
  { to: "/candidates/new", label: "New candidate" },
  {
    to: "/users/new",
    label: "New user",
    visibleForRoles: ["SUPER_ADMIN", "HR_ADMIN"],
  },
];

export function AppShell({ children }: { children?: ReactNode }) {
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.visibleForRoles || (user && item.visibleForRoles.includes(user.role))),
  })).filter((group) => group.items.length > 0);

  const visibleQuickActions = QUICK_ACTIONS.filter(
    (action) => !action.visibleForRoles || (user && action.visibleForRoles.includes(user.role)),
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background p-3">
      <aside
        className={cn(
          "flex shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-[width] duration-300 ease-out",
          collapsed ? "w-[76px]" : "w-64",
        )}
      >
        <div className="gear-edge" />
        <div className={cn("flex items-center gap-2.5 px-4 py-4", collapsed && "justify-center px-0")}>
          <img src={simatsSeal} alt="SIMATS" className="h-9 w-9 shrink-0 object-contain" />
          {!collapsed ? (
            <div className="leading-tight">
              <div className="font-display text-sm font-bold tracking-normal">SIMATS</div>
              <div className="text-[11px] text-muted-foreground">Recruitment</div>
            </div>
          ) : null}
        </div>

        <nav className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
          {visibleGroups.map((group) => (
            <div key={group.label ?? "top"} className="flex flex-col gap-0.5">
              {group.label && !collapsed ? (
                <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </div>
              ) : null}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 rounded-full px-3 py-2 text-sm text-foreground/70 transition-colors duration-200 hover:bg-brand-primary-light hover:text-primary",
                      collapsed && "justify-center px-0",
                      isActive &&
                        "bg-gradient-to-r from-primary to-brand-secondary font-medium text-primary-foreground shadow-sm hover:from-primary hover:to-brand-secondary hover:text-primary-foreground",
                    )
                  }
                >
                  <item.icon className="h-[18px] w-[18px] shrink-0" />
                  {!collapsed ? item.label : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <Button
            variant="ghost"
            size="sm"
            className={cn("w-full", collapsed && "px-0")}
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!collapsed ? "Collapse" : null}
          </Button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden pl-3">
        <header className="flex h-[72px] shrink-0 items-center gap-4 rounded-2xl border border-border bg-card/70 px-6 shadow-sm backdrop-blur-xl">
          <CampusSwitcher />
          <div className="flex flex-1 justify-center px-4">
            <GlobalSearch />
          </div>
          <div className="flex items-center gap-2">
            {visibleQuickActions.length > 0 ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" className="gap-1.5">
                    <Plus className="h-4 w-4" />
                    Quick actions
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-1">
                  <ul className="flex flex-col">
                    {visibleQuickActions.map((action) => (
                      <li key={action.to}>
                        <Link
                          to={action.to}
                          className="block rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          {action.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            ) : null}
            <div className="mx-1 hidden text-right text-sm sm:block">
              <div className="font-medium">{user?.full_name}</div>
              <div className="text-xs text-muted-foreground">{user?.role.replace(/_/g, " ")}</div>
            </div>
            <NotificationBell />
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] p-8">{children ?? <Outlet />}</div>
        </main>
      </div>
    </div>
  );
}
