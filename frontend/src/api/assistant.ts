// Module 14 "Hermes" assistant API module -- backs the floating
// AssistantWidget (frontend/src/components/assistant/). See
// app/api/v1/routers/assistant.py / app/schemas/assistant.py for the
// contract this mirrors.

import { apiFetch, apiFetchBlob } from "@/api/client";
import type { AssistantQueryResponse, ConversationTurn } from "@/api/types";

export async function queryAssistant(
  question: string,
  conversationHistory?: ConversationTurn[],
): Promise<AssistantQueryResponse> {
  return apiFetch<AssistantQueryResponse>("/assistant/query", {
    method: "POST",
    body: JSON.stringify({
      question,
      // Omitted entirely (not sent as []) when there's no history yet --
      // matches AssistantQueryRequest.conversation_history's `| None`
      // optionality on the backend.
      conversation_history: conversationHistory && conversationHistory.length > 0 ? conversationHistory : undefined,
    }),
  });
}

/** Downloads a Blob (auth-header-carrying) and triggers a browser save --
 * same pattern as downloadReportExport (api/reports.ts) and downloadResume
 * (api/candidates.ts): a plain <a href> can't carry the Bearer token. Kept
 * as its own small copy here (rather than importing reports.ts's private
 * helper) since it's a one-line function and reports.ts doesn't export it. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Triggers an Excel export for an `export_excel` AssistantAction --
 * GET /reports/{report_type}/export, the exact same endpoint ReportsPage's
 * downloadReportExport calls, just addressed with the action's own
 * (possibly report-type-union-widening) report_type/params instead of a
 * ReportsPage-typed ReportType. */
export async function downloadAssistantExport(reportType: string, params: Record<string, string> = {}): Promise<void> {
  const query = new URLSearchParams(params).toString();
  const blob = await apiFetchBlob(`/reports/${reportType}/export${query ? `?${query}` : ""}`);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  triggerDownload(blob, `simats-${reportType}-${date}.xlsx`);
}
