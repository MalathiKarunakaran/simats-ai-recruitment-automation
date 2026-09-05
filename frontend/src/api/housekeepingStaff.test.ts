import { beforeEach, describe, expect, it, vi } from "vitest";

import { API_BASE_URL, configureAuth } from "@/api/client";
import {
  createHousekeepingStaff,
  deleteHousekeepingStaff,
  listHousekeepingStaff,
  updateHousekeepingStaff,
} from "@/api/housekeepingStaff";
import type { HousekeepingStaffRead } from "@/api/types";

// Mirrors client.test.ts's fetch-spy approach -- no dedicated *.test.ts file
// exists yet for locations.ts/designations.ts (those are only exercised
// through their page-level tests), but the plan explicitly asks for
// coverage of this new module, so this exercises the real apiFetch path
// (URL/method/body) directly rather than mocking apiFetch itself.

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const RECORD: HousekeepingStaffRead = {
  id: "hk-1",
  campus_id: "c-sse",
  bio_id: "BIO-001",
  employee_id: null,
  name: "Kamala Devi",
  designation_id: "d-hk-1",
  location_id: "l-1",
  block: "Block A",
  floor_venue: "Ground Floor",
  shift: "MORNING",
  supervisor: "Ramesh",
  is_active: true,
  created_by_id: "u-1",
  updated_by_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("housekeepingStaff API module", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    configureAuth({
      getAccessToken: () => "token-123",
      setAccessToken: vi.fn(),
      refreshAccessToken: vi.fn(),
      onAuthFailure: vi.fn(),
      onPasswordChangeRequired: vi.fn(),
    });
  });

  it("listHousekeepingStaff GETs /housekeeping-staff?limit=200 and unwraps items", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(200, { items: [RECORD], total: 1, limit: 200, offset: 0 }));

    const result = await listHousekeepingStaff();

    expect(result).toEqual([RECORD]);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/housekeeping-staff?limit=200`);
    expect(init?.method).toBeUndefined();
  });

  it("createHousekeepingStaff POSTs the payload to /housekeeping-staff", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(201, RECORD));
    const payload = {
      campus_id: "c-sse",
      bio_id: "BIO-001",
      name: "Kamala Devi",
      designation_id: "d-hk-1",
      location_id: "l-1",
      shift: "MORNING" as const,
    };

    const result = await createHousekeepingStaff(payload);

    expect(result).toEqual(RECORD);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/housekeeping-staff`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual(payload);
  });

  it("updateHousekeepingStaff PATCHes /housekeeping-staff/{id}", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(200, { ...RECORD, name: "Updated Name" }));

    const result = await updateHousekeepingStaff("hk-1", { name: "Updated Name" });

    expect(result.name).toBe("Updated Name");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/housekeeping-staff/hk-1`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "Updated Name" });
  });

  it("deleteHousekeepingStaff DELETEs /housekeeping-staff/{id}", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    await deleteHousekeepingStaff("hk-1");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/housekeeping-staff/hk-1`);
    expect(init?.method).toBe("DELETE");
  });

  it("surfaces the backend's exact bio_id conflict message via ApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(409, { detail: "bio_id 'BIO-001' is already in use on this campus." }),
    );

    await expect(
      createHousekeepingStaff({
        campus_id: "c-sse",
        bio_id: "BIO-001",
        name: "Kamala Devi",
        designation_id: "d-hk-1",
        location_id: "l-1",
        shift: "MORNING",
      }),
    ).rejects.toMatchObject({ status: 409, message: "bio_id 'BIO-001' is already in use on this campus." });
  });
});
