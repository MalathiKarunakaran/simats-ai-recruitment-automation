import type { ChannelConfigurationStatus, JobPostingChannelStatus, JobPostingStatus } from "@/api/types";
import { Badge } from "@/components/ui/badge";

type Variant = "default" | "info" | "caution" | "success" | "destructive" | "outline";

// Mirrors app/models/enums.py::JobPostingStatusEnum.
const POSTING: Record<JobPostingStatus, { variant: Variant; label: string }> = {
  DRAFT: { variant: "default", label: "Draft" },
  READY_FOR_REVIEW: { variant: "caution", label: "In review" },
  APPROVED: { variant: "info", label: "Approved" },
  PUBLISHED: { variant: "success", label: "Published" },
  PAUSED: { variant: "caution", label: "Paused" },
  CLOSED: { variant: "outline", label: "Closed" },
};

export function PostingStatusBadge({ status }: { status: JobPostingStatus }) {
  return <Badge variant={POSTING[status].variant}>{POSTING[status].label}</Badge>;
}

// Mirrors app/models/enums.py::JobPostingChannelStatusEnum. The stored values
// are unchanged (2026-09-15); these are the words a recruiter reads for them.
const CHANNEL: Record<JobPostingChannelStatus, { variant: Variant; label: string }> = {
  RECOMMENDED: { variant: "info", label: "Recommended" },
  SELECTED: { variant: "default", label: "Selected" },
  QUEUED: { variant: "caution", label: "Manual action required" },
  POSTED: { variant: "success", label: "Published" },
  FAILED: { variant: "destructive", label: "Failed" },
  EXPIRED: { variant: "outline", label: "Expired" },
  REMOVED: { variant: "outline", label: "Closed" },
};

export function ChannelStatusBadge({ status }: { status: JobPostingChannelStatus }) {
  return <Badge variant={CHANNEL[status].variant}>{CHANNEL[status].label}</Badge>;
}

// Mirrors app/services/channel_providers.py's configuration statuses.
const CONFIGURATION: Record<ChannelConfigurationStatus, { variant: Variant; label: string }> = {
  AUTOMATIC: { variant: "success", label: "Automatic" },
  MANUAL: { variant: "caution", label: "Manual posting" },
  READY: { variant: "info", label: "Integration ready" },
  NOT_CONFIGURED: { variant: "outline", label: "Integration not configured" },
};

export function ChannelConfigurationBadge({ status }: { status: ChannelConfigurationStatus }) {
  return <Badge variant={CONFIGURATION[status].variant}>{CONFIGURATION[status].label}</Badge>;
}
