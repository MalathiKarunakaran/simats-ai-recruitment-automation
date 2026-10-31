// Coarse "5 min ago" / "3 days ago" wording for a past timestamp.
export function relativeTime(date: Date, now: number = Date.now()): string {
  const seconds = Math.round((now - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
