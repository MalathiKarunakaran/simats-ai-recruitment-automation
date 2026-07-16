import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";

import { listNotifications } from "@/api/notifications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// This backend tracks delivery status (PENDING/SENT/FAILED) per
// notification, not per-user read/unread state -- there's no "unread
// count" to show here. The badge instead surfaces FAILED deliveries, a
// real signal worth a staff member's attention, rather than a fabricated
// unread count.
export function NotificationBell() {
  const { data: notifications } = useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: () => listNotifications(20),
    refetchInterval: 60_000,
  });

  const failedCount = notifications?.filter((n) => n.status === "FAILED").length ?? 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {failedCount > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {failedCount}
            </span>
          ) : null}
          <span className="sr-only">Notifications</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
          Recent notifications
        </div>
        {!notifications || notifications.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">Nothing to show yet.</p>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {notifications.map((n) => (
              <li key={n.id} className="flex flex-col gap-0.5 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{n.subject}</span>
                  {n.status === "FAILED" ? <Badge variant="destructive">Failed</Badge> : null}
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                <span className="text-[11px] text-muted-foreground">
                  {new Date(n.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
