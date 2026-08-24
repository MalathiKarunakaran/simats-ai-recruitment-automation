import type { AssistantAction } from "@/api/types";

/** The widget's own transcript entry -- a superset of ConversationTurn
 * (api/types.ts) with the extra local-only fields (`actions`, `status`,
 * `question`) needed to render pending/error states and action buttons.
 * Only committed (no `status`) turns are ever sent back as
 * conversation_history -- see buildConversationHistory in
 * AssistantWidget.tsx. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: AssistantAction[];
  /** Present while a query is in flight, or after it fails -- absent for a
   * normal committed message. */
  status?: "pending" | "error";
  /** Only set on an errored assistant message: the exact question text that
   * failed, so the Retry button can resend it verbatim without needing to
   * reconstruct it from this message's own (empty) content. */
  question?: string;
}
