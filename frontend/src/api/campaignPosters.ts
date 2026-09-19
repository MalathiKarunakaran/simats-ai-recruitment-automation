import { apiFetchBlob } from "@/api/client";

export interface CampaignPosterOptions {
  // Ribbon across the sheet, e.g. "Join our maintenance team". Backend caps it at 60.
  title?: string;
  pitch?: string;
}

// One A4 sheet advertising up to six PUBLISHED postings from ONE campus.
// JOB_DISTRIBUTION. The backend refuses a mix of campuses (400) and any
// posting that is not published (409), naming the offender.
export async function getCampaignPosterBlob(postingIds: string[], options: CampaignPosterOptions = {}): Promise<Blob> {
  const params = new URLSearchParams({ posting_ids: postingIds.join(",") });
  if (options.title) params.set("title", options.title);
  if (options.pitch) params.set("pitch", options.pitch);
  return apiFetchBlob(`/campaign-posters?${params.toString()}`);
}
