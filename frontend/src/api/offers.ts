import { apiFetch } from "@/api/client";
import type { OfferCreatePayload, OfferRead, PaginatedResponse } from "@/api/types";

interface ListOffersFilters {
  applicationId?: string | null;
}

export async function listOffers(filters: ListOffersFilters = {}): Promise<OfferRead[]> {
  const params = new URLSearchParams({ limit: "200" });
  if (filters.applicationId) params.set("application_id", filters.applicationId);
  const response = await apiFetch<PaginatedResponse<OfferRead>>(`/offers?${params.toString()}`);
  return response.items;
}

export async function getOffer(id: string): Promise<OfferRead> {
  return apiFetch<OfferRead>(`/offers/${id}`);
}

export async function createOffer(payload: OfferCreatePayload): Promise<OfferRead> {
  return apiFetch<OfferRead>("/offers", { method: "POST", body: JSON.stringify(payload) });
}

export async function sendOffer(id: string): Promise<OfferRead> {
  return apiFetch<OfferRead>(`/offers/${id}/send`, { method: "POST" });
}

export async function acceptOffer(id: string): Promise<OfferRead> {
  return apiFetch<OfferRead>(`/offers/${id}/accept`, { method: "POST" });
}

export async function declineOffer(id: string, reason: string): Promise<OfferRead> {
  return apiFetch<OfferRead>(`/offers/${id}/decline`, { method: "POST", body: JSON.stringify({ reason }) });
}

export async function withdrawOffer(id: string): Promise<OfferRead> {
  return apiFetch<OfferRead>(`/offers/${id}/withdraw`, { method: "POST" });
}

export async function markOfferExpired(id: string): Promise<OfferRead> {
  return apiFetch<OfferRead>(`/offers/${id}/mark-expired`, { method: "POST" });
}
