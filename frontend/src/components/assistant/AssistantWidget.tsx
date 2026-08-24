import { Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

import { queryAssistant } from "@/api/assistant";
import { ApiError } from "@/api/client";
import type { ConversationTurn } from "@/api/types";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";

import { AssistantPanel } from "./AssistantPanel";
import type { ChatMessage } from "./types";

// Mirrors app/services/hermes.py::_MAX_CONVERSATION_HISTORY_TURNS -- the
// backend already caps to the last 10 turns itself, but capping client-side
// too keeps this widget's own request payload bounded regardless of how
// long a session has run, per the task brief.
const MAX_CONVERSATION_HISTORY_TURNS = 10;

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/** Only committed (non-pending/non-error) turns are ever sent back as
 * conversation_history -- an in-flight or failed turn was never a real
 * exchange the backend should be told happened. */
function buildConversationHistory(messages: ChatMessage[]): ConversationTurn[] {
  const committed = messages
    .filter((message) => !message.status)
    .map((message) => ({ role: message.role, content: message.content }));
  return committed.slice(-MAX_CONVERSATION_HISTORY_TURNS);
}

// Backend gate this mirrors: app/api/v1/routers/assistant.py's _staff_only
// rejects exactly UserRoleEnum.CANDIDATE with a 403 -- every other role may
// query Hermes. UX-only; the backend re-checks this on every request.
const HIDDEN_FOR_ROLES = ["CANDIDATE"];

export function AssistantWidget() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [buttonMounted, setButtonMounted] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setButtonMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!user || HIDDEN_FOR_ROLES.includes(user.role)) {
    return null;
  }

  async function runQuery(question: string, history: ConversationTurn[], pendingId: string) {
    setIsSending(true);
    try {
      const response = await queryAssistant(question, history);
      setMessages((prev) =>
        prev.map((message) =>
          message.id === pendingId
            ? { id: pendingId, role: "assistant", content: response.answer, actions: response.actions }
            : message,
        ),
      );
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Could not reach the assistant. Check your connection and try again.";
      setMessages((prev) =>
        prev.map((existing) =>
          existing.id === pendingId
            ? { id: pendingId, role: "assistant", content: message, status: "error", question }
            : existing,
        ),
      );
    } finally {
      setIsSending(false);
    }
  }

  function sendMessage(question: string) {
    if (isSending) return;
    const history = buildConversationHistory(messages);
    const userMessage: ChatMessage = { id: newId(), role: "user", content: question };
    const pendingId = newId();
    const pendingMessage: ChatMessage = { id: pendingId, role: "assistant", content: "", status: "pending" };
    setMessages((prev) => [...prev, userMessage, pendingMessage]);
    void runQuery(question, history, pendingId);
  }

  function retryMessage(question: string) {
    if (isSending || !question) return;
    // Reuses the same errored message row (no new user bubble) -- the
    // question was already shown once as a user bubble before this failed
    // assistant turn; retrying shouldn't duplicate it.
    const failedIndex = messages.findIndex((message) => message.status === "error" && message.question === question);
    if (failedIndex === -1) return;
    const pendingId = messages[failedIndex].id;
    const history = buildConversationHistory(messages.slice(0, failedIndex));
    setMessages((prev) =>
      prev.map((message) => (message.id === pendingId ? { id: pendingId, role: "assistant", content: "", status: "pending" } : message)),
    );
    void runQuery(question, history, pendingId);
  }

  return (
    <>
      <AssistantPanel
        open={isOpen}
        messages={messages}
        isSending={isSending}
        onClose={() => setIsOpen(false)}
        onSend={sendMessage}
        onRetry={retryMessage}
      />
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={isOpen ? "Close assistant" : "Open assistant"}
        className={cn(
          "fixed bottom-6 right-6 z-50 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[var(--brand-primary)] to-[var(--brand-primary-hover)] text-primary-foreground shadow-[var(--shadow-card-hover)] transition-all duration-300 ease-out hover:brightness-95 motion-reduce:transition-none",
          // On a full-screen mobile panel (below `sm`) the panel would sit
          // underneath this button in the same stacking context (both
          // z-50, this button painted later in the DOM) -- hide it while
          // open there. At `sm`+ the panel is a bottom-right inset with
          // room left below it for this button (see AssistantPanel's own
          // sm:bottom-24), so no overlap and the button stays visible.
          isOpen && "hidden sm:grid",
          buttonMounted ? "scale-100 opacity-100" : "scale-75 opacity-0",
        )}
      >
        {isOpen ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </button>
    </>
  );
}
