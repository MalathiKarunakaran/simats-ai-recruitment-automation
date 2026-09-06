import { apiFetch } from "@/api/client";
import type {
  ChannelRuleCreatePayload,
  ChannelRuleRead,
  ChannelRuleUpdatePayload,
  PaginatedResponse,
  RecruitmentChannelCreatePayload,
  RecruitmentChannelRead,
  RecruitmentChannelUpdatePayload,
} from "@/api/types";

// Reads are staff-wide (recruitment_channels.py::_staff_only); writes need
// MANAGE_RECRUITMENT_CHANNELS or the SUPER_ADMIN / HR_ADMIN role (_write_gate).

export async function listRecruitmentChannels(includeInactive = true): Promise<RecruitmentChannelRead[]> {
  const suffix = includeInactive ? "" : "&is_active=true";
  const response = await apiFetch<PaginatedResponse<RecruitmentChannelRead>>(
    `/recruitment-channels?limit=200${suffix}`,
  );
  return response.items;
}

export async function createRecruitmentChannel(payload: RecruitmentChannelCreatePayload): Promise<RecruitmentChannelRead> {
  return apiFetch<RecruitmentChannelRead>("/recruitment-channels", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateRecruitmentChannel(
  id: string,
  payload: RecruitmentChannelUpdatePayload,
): Promise<RecruitmentChannelRead> {
  return apiFetch<RecruitmentChannelRead>(`/recruitment-channels/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function listChannelRules(): Promise<ChannelRuleRead[]> {
  const response = await apiFetch<PaginatedResponse<ChannelRuleRead>>("/channel-rules?limit=200");
  return response.items;
}

export async function createChannelRule(payload: ChannelRuleCreatePayload): Promise<ChannelRuleRead> {
  return apiFetch<ChannelRuleRead>("/channel-rules", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateChannelRule(id: string, payload: ChannelRuleUpdatePayload): Promise<ChannelRuleRead> {
  return apiFetch<ChannelRuleRead>(`/channel-rules/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}
