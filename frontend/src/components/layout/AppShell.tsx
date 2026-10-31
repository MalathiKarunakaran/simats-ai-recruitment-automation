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
  Database,
  FileCheck,
  History,
  IdCard,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  ListOrdered,
  MapPin,
  Megaphone,
  Newspaper,
  Plus,
  Printer,
  RefreshCw,
  Settings,
  Sparkles,
  Upload,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";

import type { Permission } from "@/api/types";
import simatsSeal from "@/assets/simats-seal.png";
import { useAuth } from "@/auth/AuthContext";
import { AssistantWidget } from "@/components/assistant/AssistantWidget";
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
  /** Bug fix (2026-08-24): an item is ALSO shown if the current user has been
   * individually granted this permission via the Permission Matrix, even
   * when their role isn't in visibleForRoles -- previously a granted
   * permission had no effect on nav visibility at all, so e.g. a
   * RECRUITMENT_COORDINATOR given MANAGE_USERS could call the API but never
   * saw the "Users" link to get there. Additive: doesn't change any
   * already-visible-by-role item's behavior. */
  /** One permission, or several any-of. The array form (2026-09-01) exists
   * for Vacancy Approvals, whose page is open to holders of either
   * APPROVE_VACANCY or REJECT_VACANCY -- a single value could only ever name
   * one of the two. */
  visibleForPermission?: Permission | Permission[];
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
        // Mirrors the page's own read gate. That was `_staff_only` (any
        // authenticated staff member) until 2026-08-31, when it became
        // require_permission(VIEW_SANCTIONED_STRENGTH) -- so the nav follows
        // the permission rather than staying unconditionally visible, which
        // would send a user whose VIEW was revoked to a 403 page. Every role
        // holds it by default, so this hides the item only where a Super
        // Admin has deliberately taken it away.
        //
        // Moved here from Administration (and renamed from "Vacancy
        // Register") per zany-snuggling-pie.md Phase C -- sits directly above
        // "Vacancy Requests" since it's the ceiling requests are made against.
        visibleForPermission: "VIEW_SANCTIONED_STRENGTH",
      },
      { to: "/vacancy-requests", label: "Vacancy Requests", icon: Briefcase },
      {
        to: "/vacancy-approvals",
        label: "Vacancy Approvals",
        icon: ClipboardCheck,
        // Mirrors VacancyApprovalsPage's own ACTIONABLE_STATUSES_BY_ROLE --
        // only roles that actually take part in the approval chain see this.
        visibleForRoles: ["ASSOCIATE_DEAN_RECRUITMENT", "HR_ADMIN", "SUPER_ADMIN", "RECRUITMENT_COORDINATOR"],
        // ...plus anyone individually granted one of the two permissions that
        // page is gated on, so a granted approver can actually reach it.
        // Matches the page's own `statuses` union, which is what decides
        // whether they see a queue once they get there.
        visibleForPermission: ["APPROVE_VACANCY", "REJECT_VACANCY"],
      },
      { to: "/job-postings", label: "Job Postings", icon: Newspaper },
      {
        to: "/talent-pool",
        label: "Talent Pool",
        icon: Database,
        // Mirrors talent_pool.py's own require_roles(HR_ADMIN, SUPER_ADMIN,
        // RECRUITMENT_COORDINATOR).
        // No visibleForPermission: that router is role-gated and adds no
        // PermissionEnum value, so there is nothing to grant individually.
        visibleForRoles: ["HR_ADMIN", "SUPER_ADMIN", "RECRUITMENT_COORDINATOR"],
      },
      {
        to: "/selection-batches",
        label: "Selection Batches",
        icon: ListChecks,
        // Mirrors selection_batches.py's require_roles(SUPER_ADMIN, HR_ADMIN,
        // RECRUITMENT_COORDINATOR); no PermissionEnum value to grant.
        visibleForRoles: ["SUPER_ADMIN", "HR_ADMIN", "RECRUITMENT_COORDINATOR"],
      },
      {
        to: "/campaign-poster",
        label: "Campaign Poster",
        icon: Printer,
        // Mirrors campaign_posters.py::_poster_gate (JOB_DISTRIBUTION).
        visibleForPermission: "JOB_DISTRIBUTION",
      },
    ],
  },
  {
    // Read-only screens over the synced joining sheets
    // (docs/specs/joining-screens.md). All three mirror joining_records.py's
    // require_roles(SUPER_ADMIN, HR_ADMIN, RECRUITMENT_COORDINATOR); that
    // router adds no PermissionEnum value, so there is nothing to grant.
    label: "Joining",
    items: [
      {
        to: "/joinees",
        label: "New Joinees",
        icon: UserPlus,
        visibleForRoles: ["SUPER_ADMIN", "HR_ADMIN", "RECRUITMENT_COORDINATOR"],
      },
      {
        to: "/provisional-orders",
        label: "Provisional Orders",
        icon: FileCheck,
        visibleForRoles: ["SUPER_ADMIN", "HR_ADMIN", "RECRUITMENT_COORDINATOR"],
      },
      {
        to: "/new-departments",
        label: "New Departments",
        icon: Building2,
        visibleForRoles: ["SUPER_ADMIN", "HR_ADMIN", "RECRUITMENT_COORDINATOR"],
      },
    ],
  },
  {
    label: "Candidates",
    items: [
      { to: "/candidates", label: "Candidates", icon: Users },
      { to: "/applications", label: "Applications", icon: Briefcase },
      // No visibleForRoles: application_outcomes.py is gated like GET
      // /applications (any staff member, campus-scoped).
      { to: "/rejected-waiting-list", label: "Rejected & Waiting List", icon: ListOrdered },
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
        // Mirrors OnboardingListPage's own CAN_VIEW_ROLES. CAMPUS_HOD sees
        // only the HOD-review stages there (joining.py's review endpoints).
        visibleForRoles: [
          "HR_ADMIN",
          "RECRUITMENT_OFFICER",
          "SUPER_ADMIN",
          "RECRUITMENT_COORDINATOR",
          "CAMPUS_HOD",
        ],
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
        to: "/sheet-sync",
        label: "Data Sync Status",
        icon: RefreshCw,
        // Mirrors sheet_sync.py's GET /sheet-sync/runs: require_roles(SUPER_ADMIN).
        visibleForRoles: ["SUPER_ADMIN"],
      },
      {
        to: "/users",
        label: "Users",
        icon: UserCog,
        // Mirrors app/models/enums.py::USER_MANAGEMENT_ROLES, PLUS anyone
        // individually granted MANAGE_USERS via the Permission Matrix (bug
        // fix 2026-08-24 -- see NavItem.visibleForPermission's own comment).
        visibleForRoles: ["SUPER_ADMIN", "HR_ADMIN"],
        visibleForPermission: "MANAGE_USERS",
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
        to: "/recruitment-channels",
        label: "Recruitment Channels",
        icon: Megaphone,
        // Mirrors recruitment_channels.py's read gate (_staff_only) -- broad
        // read; the page's own write controls check _write_gate
        // (MANAGE_RECRUITMENT_CHANNELS or SUPER_ADMIN/HR_ADMIN).
      },
      {
        to: "/housekeeping-staff",
        label: "Housekeeping Staff",
        icon: Sparkles,
        // Mirrors housekeeping_staff.py's own read gate (_staff_only,
        // campus-scoped for non-global roles) -- broad read, same pattern as
        // Locations above; write controls inside the page itself check
        // HOUSEKEEPING_STAFF_MANAGEMENT_ROLES (SUPER_ADMIN/HR_ADMIN/
        // RECRUITMENT_OFFICER -- housekeeping_staff.py's _WRITE_ROLES,
        // corrected post-merge-review to add RECRUITMENT_OFFICER on top of
        // the bare SANCTIONED_STRENGTH_WRITE_ROLES constant, same broader
        // write set as Locations, plan decision 4). Bare list page only
        // (glowing-zooming-hamming.md Phase D) -- the full location-grouped
        // operational view is Phase G's job.
      },
      {
        to: "/activity-log",
        label: "Activity Log",
        icon: History,
        // Permission only, no visibleForRoles: both audit_logs.py endpoints
        // are require_permission(ACTIVITY_LOG) and nothing else, so a role
        // list here advertised the link to role-holders without the grant,
        // who could only ever land on the page's own "no access" line.
        visibleForPermission: "ACTIVITY_LOG",
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
  const { user, logout, hasPermission } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  function isNavItemVisible(item: {
    visibleForRoles?: string[];
    visibleForPermission?: Permission | Permission[];
  }): boolean {
    if (!item.visibleForRoles && !item.visibleForPermission) return true;
    const roleMatch = Boolean(item.visibleForRoles && user && item.visibleForRoles.includes(user.role));
    const required =
      item.visibleForPermission === undefined
        ? []
        : Array.isArray(item.visibleForPermission)
          ? item.visibleForPermission
          : [item.visibleForPermission];
    const permissionMatch = required.some((permission) => hasPermission?.(permission) ?? false);
    return roleMatch || permissionMatch;
  }

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(isNavItemVisible),
  })).filter((group) => group.items.length > 0);

  const visibleQuickActions = QUICK_ACTIONS.filter(
    (action) => !action.visibleForRoles || (user && action.visibleForRoles.includes(user.role)),
  );

  return (
    <div className="app-canvas flex h-screen overflow-hidden">
      <aside
        className={cn(
          // Key-screens redesign (2026-10-29): a flush, full-height panel
          // with a right border instead of a floating rounded card; white in
          // the light theme, navy in dark (--sidebar-* tokens, index.css).
          // Every nav item/group/route/icon and the collapse behavior are
          // unchanged.
          "flex shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar-background text-sidebar-foreground transition-[width] duration-300 ease-out",
          collapsed ? "w-[76px]" : "w-64",
        )}
      >
        <div className={cn("flex items-center gap-2.5 px-4 py-4", collapsed && "justify-center px-0")}>
          {/* The SIMATS seal, plain (2026-10-29: the signature-gradient ring
              that used to frame it is gone, per the approved mock-up). The
              inner span paints the sidebar's own background behind the
              image; collapsed/expanded behavior is unchanged. */}
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full">
            <span className="grid h-full w-full place-items-center rounded-full bg-sidebar-background">
              <img src={simatsSeal} alt="SIMATS" className="h-full w-full object-contain" />
            </span>
          </span>
          {!collapsed ? (
            <div className="leading-tight">
              <div className="font-display text-sm font-bold tracking-normal text-sidebar-foreground">SIMATS</div>
              <div className="text-[11px] text-sidebar-foreground-muted">Recruitment</div>
            </div>
          ) : null}
        </div>

        <nav className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
          {visibleGroups.map((group) => (
            <div key={group.label ?? "top"} className="flex flex-col gap-0.5">
              {group.label && !collapsed ? (
                <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-sidebar-foreground-muted uppercase">
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
                      // Inactive: full-strength text with a light hover wash
                      // (--sidebar-hover-background; navy-tinted in dark).
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-foreground transition-colors duration-200 hover:bg-sidebar-hover-background",
                      collapsed && "justify-center px-0",
                      isActive &&
                        // Active: light-blue wash + blue text (2026-10-29,
                        // was a blue-to-teal gradient pill), both from the
                        // --sidebar-active-* tokens so dark mode re-tints it.
                        "bg-sidebar-active-background font-semibold text-sidebar-active-foreground hover:bg-sidebar-active-background",
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

        <div className="border-t border-sidebar-border p-3">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "w-full text-sidebar-foreground hover:bg-sidebar-hover-background hover:text-sidebar-foreground",
              collapsed && "px-0",
            )}
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!collapsed ? "Collapse" : null}
          </Button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-card px-6">
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

      {/* Module 14 "Hermes" assistant -- mounted once here (not per-page) so
          it's a persistent floating affordance across every authenticated
          page, the same way NotificationBell/ThemeToggle live in the header
          rather than each page. Hides itself for CANDIDATE (mirrors
          assistant.py's own _staff_only gate) and renders nothing until
          `user` resolves. */}
      <AssistantWidget />
    </div>
  );
}
