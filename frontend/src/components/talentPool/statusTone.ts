// Talent pool status -> visual tone (2026-10-23, spec 1.2).
//
// Colour by state, not decoration: a Selected candidate reads as success, a
// Rejected one as danger, and anything nobody has decided on stays neutral.
// Statuses arrive from a hand-edited Google Sheet, so this map is keyed
// case-insensitively and falls back to "neutral" rather than throwing -- an
// unexpected spelling must still render, just without a colour opinion.

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONES: Record<string, StatusTone> = {
  selected: "success",
  "waiting list": "warning",
  rejected: "danger",
  pending: "neutral",
  "interview scheduled": "info",
  "on hold": "warning",
  rnr: "warning",
  "not interested": "danger",
  "no outcome": "neutral",
};

export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  return TONES[status.trim().toLowerCase()] ?? "neutral";
}

// Eligibility is a separate axis from status: "With Ph.D" is the only value
// the dashboard calls eligible (the API returns that definition), thesis/viva
// is close but not there, and the rest are neutral statements of fact rather
// than bad news.
const ELIGIBILITY_TONES: Record<string, StatusTone> = {
  "with ph.d": "success",
  "thesis / viva stage": "info",
  "pursuing ph.d": "warning",
  "no ph.d": "neutral",
  "not eligible": "danger",
  "not set": "neutral",
};

export function eligibilityTone(value: string | null | undefined): StatusTone {
  if (!value) return "neutral";
  return ELIGIBILITY_TONES[value.trim().toLowerCase()] ?? "neutral";
}

const BADGE_CLASSES: Record<StatusTone, string> = {
  success: "bg-brand-success/10 text-brand-success",
  warning: "bg-brand-warning/10 text-brand-warning",
  danger: "bg-brand-danger/10 text-brand-danger",
  info: "bg-brand-primary/10 text-brand-primary",
  neutral: "bg-muted text-muted-foreground",
};

export function toneClasses(tone: StatusTone): string {
  return BADGE_CLASSES[tone];
}

/** Tone -> the repo's existing Badge variant, so status chips here look like
 * status chips everywhere else in the app rather than becoming a second,
 * nearly-identical colour system. */
export type BadgeVariant = "default" | "success" | "warning" | "destructive" | "info";

const BADGE_VARIANTS: Record<StatusTone, BadgeVariant> = {
  success: "success",
  warning: "warning",
  danger: "destructive",
  info: "info",
  neutral: "default",
};

export function toneVariant(tone: StatusTone): BadgeVariant {
  return BADGE_VARIANTS[tone];
}
