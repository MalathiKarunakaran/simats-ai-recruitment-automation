import { cn } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

// The round initials badge beside a candidate's name (key-screens redesign,
// 2026-10-29). Decorative: the name is always printed next to it.
export function CandidateInitials({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-brand-primary-light font-semibold text-[#1e3a8a] dark:bg-accent dark:text-accent-foreground",
        size === "lg" ? "h-14 w-14 font-display text-xl font-extrabold" : "h-8 w-8 text-xs",
      )}
    >
      {initials(name)}
    </span>
  );
}
