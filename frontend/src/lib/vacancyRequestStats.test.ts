import { describe, expect, it } from "vitest";

import type { VacancyRequestStatus } from "@/api/types";
import { summarizeVacancyRequestStatuses } from "@/lib/vacancyRequestStats";

const ALL_STATUSES: VacancyRequestStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "DEAN_APPROVED",
  "APPROVED",
  "PUBLISHED",
  "CLOSED",
  "REJECTED",
  "CANCELLED",
];

function sumBuckets(buckets: ReturnType<typeof summarizeVacancyRequestStatuses>): number {
  return (
    buckets.draft +
    buckets.pending +
    buckets.approved +
    buckets.published +
    buckets.closed +
    buckets.rejected +
    buckets.cancelled
  );
}

describe("summarizeVacancyRequestStatuses", () => {
  it("buckets always sum to total, for every real status value", () => {
    const rows = ALL_STATUSES.map((status) => ({ status }));
    const buckets = summarizeVacancyRequestStatuses(rows);

    expect(buckets.total).toBe(ALL_STATUSES.length);
    expect(sumBuckets(buckets)).toBe(buckets.total);
  });

  it("buckets sum to total for an arbitrary, repeated, unordered mix", () => {
    const rows: { status: VacancyRequestStatus }[] = [
      { status: "PUBLISHED" },
      { status: "DRAFT" },
      { status: "CLOSED" },
      { status: "PUBLISHED" },
      { status: "SUBMITTED" },
      { status: "DEAN_APPROVED" },
      { status: "CANCELLED" },
    ];
    const buckets = summarizeVacancyRequestStatuses(rows);

    expect(buckets.total).toBe(7);
    expect(sumBuckets(buckets)).toBe(7);
  });

  it("sums to zero total for an empty list, not an error", () => {
    const buckets = summarizeVacancyRequestStatuses([]);
    expect(buckets.total).toBe(0);
    expect(sumBuckets(buckets)).toBe(0);
  });

  it("regression: reproduces the real DRAFT/PUBLISHED/CLOSED mix that used to leave 2 of 3 requests unbucketed", () => {
    const rows: { status: VacancyRequestStatus }[] = [
      { status: "DRAFT" },
      { status: "PUBLISHED" },
      { status: "CLOSED" },
    ];
    const buckets = summarizeVacancyRequestStatuses(rows);

    expect(buckets.total).toBe(3);
    expect(buckets.draft).toBe(1);
    expect(buckets.pending).toBe(0);
    expect(buckets.approved).toBe(0);
    expect(buckets.published).toBe(1);
    expect(buckets.closed).toBe(1);
    expect(buckets.rejected).toBe(0);
    expect(buckets.cancelled).toBe(0);
    expect(sumBuckets(buckets)).toBe(3);
  });

  it("approved means APPROVED-only -- the same definition everywhere, no more PUBLISHED double-counted as approved", () => {
    const buckets = summarizeVacancyRequestStatuses([{ status: "PUBLISHED" }]);
    expect(buckets.approved).toBe(0);
    expect(buckets.published).toBe(1);
  });
});
