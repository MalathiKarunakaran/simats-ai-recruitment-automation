import { describe, expect, it } from "vitest";

import type { LocationRead } from "@/api/types";
import {
  dedupeLocationsForPicker,
  findDuplicateLocationGroups,
  locationDedupeKey,
  locationLabel,
} from "@/lib/locationDisplay";

function loc(overrides: Partial<LocationRead> & Pick<LocationRead, "id">): LocationRead {
  return {
    campus_id: "c-sse",
    name: "CB Block",
    block_building: "Circular Building",
    floor_venue: "Ground Floor",
    category: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("locationLabel", () => {
  it("joins block and floor, which is what makes same-named rows tellable apart", () => {
    expect(locationLabel(loc({ id: "1" }))).toBe("Circular Building — Ground Floor");
  });

  it("falls back to name as the block when block_building is empty", () => {
    // A half-populated record still says something useful rather than
    // collapsing to a bare floor.
    expect(locationLabel(loc({ id: "1", block_building: null, name: "SAIL" }))).toBe("SAIL — Ground Floor");
  });

  it("prints just the block when there is no floor, with no dangling dash", () => {
    expect(locationLabel(loc({ id: "1", floor_venue: null }))).toBe("Circular Building");
  });

  it("falls back to name when block and floor are both empty", () => {
    expect(locationLabel(loc({ id: "1", block_building: null, floor_venue: null, name: "Annexe" }))).toBe("Annexe");
  });

  it("treats whitespace-only fields as absent", () => {
    expect(locationLabel(loc({ id: "1", block_building: "   ", floor_venue: "  " , name: "Annexe" }))).toBe("Annexe");
  });
});

describe("locationDedupeKey", () => {
  it("ignores casing and internal whitespace", () => {
    const a = loc({ id: "1", block_building: "Circular  Building", floor_venue: "Ground Floor" });
    const b = loc({ id: "2", block_building: "circular building", floor_venue: "GROUND FLOOR" });
    expect(locationDedupeKey(a)).toBe(locationDedupeKey(b));
  });

  it("never collapses the same block+floor across two campuses", () => {
    // Two campuses may each legitimately have a "Main Block - Ground Floor".
    const a = loc({ id: "1", campus_id: "c-sse" });
    const b = loc({ id: "2", campus_id: "c-scad" });
    expect(locationDedupeKey(a)).not.toBe(locationDedupeKey(b));
  });
});

describe("dedupeLocationsForPicker", () => {
  it("collapses the real-world case: six rows all named CB Block", () => {
    const floors = ["Ground Floor", "First Floor", "Second Floor", "Third Floor", "Fourth Floor", "Fifth Floor"];
    const rows = floors.map((floor, i) => loc({ id: `l-${i}`, floor_venue: floor }));

    const options = dedupeLocationsForPicker(rows);

    // Six distinct places -- nothing is lost, they are just now tellable
    // apart, and listed in the order someone walks up the building rather
    // than alphabetically ("Fifth, First, Fourth, Ground, ...").
    expect(options).toHaveLength(6);
    expect(options.map(locationLabel)).toEqual([
      "Circular Building — Ground Floor",
      "Circular Building — First Floor",
      "Circular Building — Second Floor",
      "Circular Building — Third Floor",
      "Circular Building — Fourth Floor",
      "Circular Building — Fifth Floor",
    ]);
  });

  it("sorts blocks A-Z, then floors in physical order within each block", () => {
    const rows = [
      loc({ id: "l-1", block_building: "SAIL", floor_venue: "Seventh Floor" }),
      loc({ id: "l-2", block_building: "Circular Building", floor_venue: "First Floor" }),
      loc({ id: "l-3", block_building: "SAIL", floor_venue: "Sixth Floor" }),
      loc({ id: "l-4", block_building: "Circular Building", floor_venue: "Ground Floor" }),
    ];

    expect(dedupeLocationsForPicker(rows).map(locationLabel)).toEqual([
      "Circular Building — Ground Floor",
      "Circular Building — First Floor",
      "SAIL — Sixth Floor",
      "SAIL — Seventh Floor",
    ]);
  });

  it("puts a basement below ground and a named venue after every numbered floor", () => {
    const rows = [
      loc({ id: "l-1", floor_venue: "Auditorium" }),
      loc({ id: "l-2", floor_venue: "Second Floor" }),
      loc({ id: "l-3", floor_venue: "Basement" }),
      loc({ id: "l-4", floor_venue: "Ground Floor" }),
    ];

    expect(dedupeLocationsForPicker(rows).map((l) => l.floor_venue)).toEqual([
      "Basement",
      "Ground Floor",
      "Second Floor",
      "Auditorium",
    ]);
  });

  it("understands numeric floor spellings like 1st / 2nd", () => {
    const rows = [
      loc({ id: "l-1", floor_venue: "2nd Floor" }),
      loc({ id: "l-2", floor_venue: "1st Floor" }),
      loc({ id: "l-3", floor_venue: "Ground Floor" }),
    ];

    expect(dedupeLocationsForPicker(rows).map((l) => l.floor_venue)).toEqual([
      "Ground Floor",
      "1st Floor",
      "2nd Floor",
    ]);
  });

  it("collapses true duplicates to a single option", () => {
    const rows = [loc({ id: "l-1" }), loc({ id: "l-2" }), loc({ id: "l-3", floor_venue: "First Floor" })];
    expect(dedupeLocationsForPicker(rows)).toHaveLength(2);
  });

  it("keeps the ACTIVE record when a duplicate pair disagrees on is_active", () => {
    // Submitting an inactive location id would be a worse bug than the
    // duplicate option it replaced.
    const rows = [loc({ id: "l-1", is_active: false }), loc({ id: "l-2", is_active: true })];
    const [picked] = dedupeLocationsForPicker(rows);
    expect(picked.id).toBe("l-2");
  });

  it("breaks ties on the smallest id, so the submitted id is stable across renders", () => {
    const forward = dedupeLocationsForPicker([loc({ id: "l-9" }), loc({ id: "l-2" })]);
    const reversed = dedupeLocationsForPicker([loc({ id: "l-2" }), loc({ id: "l-9" })]);
    expect(forward[0].id).toBe("l-2");
    expect(reversed[0].id).toBe("l-2");
  });

  it("returns real, unchanged location ids", () => {
    const rows = [loc({ id: "l-1" })];
    expect(dedupeLocationsForPicker(rows)[0]).toBe(rows[0]);
  });

  it("handles an empty list", () => {
    expect(dedupeLocationsForPicker([])).toEqual([]);
  });
});

describe("findDuplicateLocationGroups", () => {
  it("reports only genuine duplicate groups, with every member included", () => {
    const rows = [
      loc({ id: "l-1" }),
      loc({ id: "l-2" }),
      loc({ id: "l-3", floor_venue: "First Floor" }),
    ];

    const groups = findDuplicateLocationGroups(rows);

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Circular Building — Ground Floor");
    // ALL members, including the one the picker keeps -- a reviewer needs the
    // full picture before deciding anything.
    expect(groups[0].locations.map((l) => l.id)).toEqual(["l-1", "l-2"]);
  });

  it("reports nothing when every location is distinct", () => {
    const rows = [loc({ id: "l-1" }), loc({ id: "l-2", floor_venue: "First Floor" })];
    expect(findDuplicateLocationGroups(rows)).toEqual([]);
  });

  it("does not flag a typo'd block as a duplicate", () => {
    // Real data has "Cicular Block" alongside "Circular Block". They are a
    // data-entry error, not the same key -- flagging them here would be a
    // false positive, and fixing the typo is a human's call.
    const rows = [
      loc({ id: "l-1", block_building: "Circular Block", floor_venue: "Fourth Floor" }),
      loc({ id: "l-2", block_building: "Cicular Block", floor_venue: "Fourth Floor" }),
    ];
    expect(findDuplicateLocationGroups(rows)).toEqual([]);
  });
});
