import type { MarkField, MarkedItem } from "@/api/joiningRecords";

/** Test-only: an OrderRead's `items` as the backend builds them when there
 * is no app mark (source "sheet" everywhere), with per-field overrides. */
export function orderItems(
  sheet: Partial<Record<MarkField, { sheet: boolean | string | null; raw?: string | null }>> = {},
  overrides: Partial<Record<MarkField, Partial<MarkedItem>>> = {},
): Record<MarkField, MarkedItem> {
  const fields: MarkField[] = [
    "id_card_done",
    "food_app_done",
    "arms_done",
    "app_360_done",
    "adfa_file_done",
    "room_allotted",
    "order_status",
    "outcome",
    "registrar_order_issued",
    "registrar_order_date",
    "orientation_conducted",
    "orientation_date",
  ];
  return Object.fromEntries(
    fields.map((f) => {
      const s = sheet[f];
      const value = s?.sheet ?? null;
      const base: MarkedItem = {
        effective: value,
        sheet: value,
        sheet_raw: s?.raw ?? (typeof value === "string" ? value : null),
        app: null,
        source: "sheet",
        marked_by: null,
        marked_at: null,
      };
      return [f, { ...base, ...overrides[f] }];
    }),
  ) as Record<MarkField, MarkedItem>;
}
