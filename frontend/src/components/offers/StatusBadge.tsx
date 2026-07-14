import type { OfferStatus } from "@/api/types";
import { Badge, type BadgeProps } from "@/components/ui/badge";

const STATUS_VARIANT: Record<OfferStatus, BadgeProps["variant"]> = {
  DRAFT: "outline",
  SENT: "default",
  ACCEPTED: "success",
  DECLINED: "destructive",
  EXPIRED: "destructive",
  WITHDRAWN: "outline",
};

export function StatusBadge({ status }: { status: OfferStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>;
}
