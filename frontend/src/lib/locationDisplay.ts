import type { LocationRead } from "@/api/types";

// Location Master stores three separate strings -- `name`, `block_building`
// and `floor_venue` -- and only the combination is unique in practice. Real
// data has six rows all named "CB Block", distinguished solely by
// floor_venue ("Ground Floor" ... "Fifth Floor"), so a dropdown keyed on
// `name` alone renders six identical options and the user cannot tell them
// apart. Every location dropdown in the app therefore goes through
// `locationLabel` rather than printing `.name`.
//
// This module is display + client-side de-duplication ONLY. It never
// mutates, hides or deletes a Location record: `dedupeLocationsForPicker`
// collapses options in the picker, and `findDuplicateLocationGroups` surfaces
// the underlying records so a human can decide what to do about them. The
// location id a picker emits is always a real, unchanged id.

const EM_DASH = "—";

/** Trimmed, case- and whitespace-insensitive form used for grouping only.
 * Never displayed -- two rows differing merely in casing or spacing are the
 * same physical place to a human reading a dropdown. */
function normalizePart(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * "Circular Building — Ground Floor".
 *
 * Falls back gracefully rather than rendering a dangling dash or an empty
 * option: block-only and floor-only rows print the one part they have, and a
 * row with neither falls back to `name`, which is NOT NULL. `name` is used as
 * the block when block_building is empty so a half-populated record still
 * says something useful instead of collapsing to just a floor.
 */
export function locationLabel(location: Pick<LocationRead, "name" | "block_building" | "floor_venue">): string {
  const block = (location.block_building ?? "").trim() || (location.name ?? "").trim();
  const floor = (location.floor_venue ?? "").trim();
  if (block && floor) return `${block} ${EM_DASH} ${floor}`;
  return block || floor || (location.name ?? "").trim();
}

// Floors are named, not numbered, so sorting the rendered label alphabetically
// produces "Fifth, First, Fourth, Ground, Second, Third" -- worse than useless
// to someone scanning for a floor. This ranks the ordinals people actually
// type. Anything unrecognised (a venue name like "Auditorium") sorts after
// every known floor, alphabetically among itself, rather than being forced
// into a numeric position it does not have.
const FLOOR_RANK: ReadonlyMap<string, number> = new Map([
  ["sub basement", -3],
  ["lower basement", -2],
  ["basement", -1],
  ["ground", 0],
  ["mezzanine", 0.5],
  ["first", 1],
  ["second", 2],
  ["third", 3],
  ["fourth", 4],
  ["fifth", 5],
  ["sixth", 6],
  ["seventh", 7],
  ["eighth", 8],
  ["ninth", 9],
  ["tenth", 10],
  ["eleventh", 11],
  ["twelfth", 12],
]);

const UNRANKED_FLOOR = Number.POSITIVE_INFINITY;

/** Rank for a floor string, tolerant of "Ground Floor" / "ground" / "1st Floor". */
export function floorRank(floorVenue: string | null | undefined): number {
  const raw = normalizePart(floorVenue);
  if (!raw) return UNRANKED_FLOOR;
  const withoutFloorWord = raw.replace(/\bfloors?\b/g, "").trim();
  const named = FLOOR_RANK.get(withoutFloorWord);
  if (named !== undefined) return named;
  // "1st", "2nd", "12th", or a bare number.
  const numeric = withoutFloorWord.match(/^(\d+)(?:st|nd|rd|th)?$/);
  if (numeric) return Number(numeric[1]);
  return UNRANKED_FLOOR;
}

/** The grouping key: same campus + same block + same floor is the same place.
 * Campus is part of the key because two campuses may each legitimately have a
 * "Main Block — Ground Floor" and those must never collapse together. */
export function locationDedupeKey(location: Pick<LocationRead, "campus_id" | "name" | "block_building" | "floor_venue">): string {
  const block = normalizePart(location.block_building) || normalizePart(location.name);
  return `${location.campus_id}|${block}|${normalizePart(location.floor_venue)}`;
}

/**
 * One option per distinct physical place, sorted for a human.
 *
 * Which record wins when several share a key is deliberate and stable rather
 * than "whichever came first from the API": an ACTIVE row always beats an
 * inactive one (picking an inactive location would be a worse bug than the
 * duplicate itself), and ties break on the smallest id so the same option is
 * chosen on every render and across page loads. A picker that silently
 * changed which id it submitted between renders would be far harder to
 * diagnose than the duplicate list it replaced.
 *
 * Sorted block-first (alphabetically), then by FLOOR ORDER within a block --
 * Ground, First, Second, Third -- because that is how someone scans for a
 * floor. Sorting the rendered label alphabetically instead would give
 * "Fifth, First, Fourth, Ground, Second, Third".
 */
export function dedupeLocationsForPicker<T extends LocationRead>(locations: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const location of locations) {
    const key = locationDedupeKey(location);
    const incumbent = best.get(key);
    if (incumbent === undefined) {
      best.set(key, location);
      continue;
    }
    if (location.is_active !== incumbent.is_active) {
      if (location.is_active) best.set(key, location);
      continue;
    }
    if (location.id < incumbent.id) best.set(key, location);
  }
  return [...best.values()].sort(compareLocationsForDisplay);
}

/** Block A-Z, then floor in physical order within each block. */
export function compareLocationsForDisplay(
  a: Pick<LocationRead, "name" | "block_building" | "floor_venue">,
  b: Pick<LocationRead, "name" | "block_building" | "floor_venue">,
): number {
  const blockA = (a.block_building ?? "").trim() || (a.name ?? "").trim();
  const blockB = (b.block_building ?? "").trim() || (b.name ?? "").trim();
  const byBlock = blockA.localeCompare(blockB, undefined, { numeric: true, sensitivity: "base" });
  if (byBlock !== 0) return byBlock;

  const rankA = floorRank(a.floor_venue);
  const rankB = floorRank(b.floor_venue);
  if (rankA !== rankB) return rankA - rankB;

  // Same rank: either two unranked venues, or identical floors. Fall back to
  // the floor text so the order is at least deterministic.
  return (a.floor_venue ?? "").localeCompare(b.floor_venue ?? "", undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export interface DuplicateLocationGroup {
  /** The shared label these records all render as. */
  label: string;
  /** Every record sharing the key -- ALL of them, including the one the
   * picker keeps, so a reviewer sees the full picture before acting. */
  locations: LocationRead[];
}

/**
 * Groups of records that a picker collapses into one option.
 *
 * Surfaced on the Locations master page as a warning so duplicates are
 * visible and fixable by a human. Deliberately NOT wired to any automatic
 * merge or delete: these are master-data records that Sanctioned Strength and
 * the Housekeeping roster reference by id, so removing the wrong one would
 * orphan real data. Reporting them is the safe half of the fix.
 */
export function findDuplicateLocationGroups(locations: readonly LocationRead[]): DuplicateLocationGroup[] {
  const byKey = new Map<string, LocationRead[]>();
  for (const location of locations) {
    const key = locationDedupeKey(location);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(location);
    else byKey.set(key, [location]);
  }
  return [...byKey.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({ label: locationLabel(group[0]), locations: group }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));
}
