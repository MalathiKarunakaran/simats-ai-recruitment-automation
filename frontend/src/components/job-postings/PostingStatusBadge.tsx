import type { JobPostingChannelStatus, JobPostingStatus } from "@/api/types";
import { Badge } from "@/components/ui/badge";

// Mirrors app/models/enums.py::JobPostingStatusEnum.
const POSTING_VARIANT: Record<JobPostingStatus, "success" | "caution" | "outline"> = {
  PUBLISHED: "success",
  PAUSED: "caution",
  CLOSED: "outline",
};

export function PostingStatusBadge({ status }: { status: JobPostingStatus }) {
  return <Badge variant={POSTING_VARIANT[status]}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

// Mirrors app/models/enums.py::JobPostingChannelStatusEnum.
const CHANNEL_VARIANT: Record<JobPostingChannelStatus, "info" | "default" | "caution" | "success" | "destructive" | "outline"> = {
  RECOMMENDED: "info",
  SELECTED: "default",
  QUEUED: "caution",
  POSTED: "success",
  FAILED: "destructive",
  EXPIRED: "outline",
  REMOVED: "outline",
};

export function ChannelStatusBadge({ status }: { status: JobPostingChannelStatus }) {
  return <Badge variant={CHANNEL_VARIANT[status]}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}
