import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export interface Breadcrumb {
  label: string;
  to?: string;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: Breadcrumb[];
  actions?: ReactNode;
}

// Shared header for every page: title/description on the left, a trail of
// breadcrumbs above it, and an actions slot on the right (New/Export/Filter
// buttons etc.). Introduced as part of the design-system pass -- adopted
// page-by-page rather than force-fit everywhere in one sweep.
export function PageHeader({ title, description, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1.5">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                  {crumb.to && !isLast ? (
                    <Link to={crumb.to} className="transition-colors hover:text-foreground hover:underline">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className={isLast ? "text-foreground" : undefined}>{crumb.label}</span>
                  )}
                  {!isLast ? <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
                </span>
              );
            })}
          </nav>
        ) : null}
        <h1 className="font-display text-page-title font-bold tracking-normal text-foreground">{title}</h1>
        {description ? <p className="text-sm text-body-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
