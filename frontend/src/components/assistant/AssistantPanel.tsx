import { Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { AssistantMessage } from "./AssistantMessage";
import type { ChatMessage } from "./types";

// The task's own example question list -- static UI copy (pre-filled
// questions), not a canned/fake answer; the actual response always comes
// from a real queryAssistant call.
const SUGGESTED_QUESTIONS = [
  "How many vacancies are there currently?",
  "Show vacancies by department.",
  "Which departments have the highest vacancies?",
  "Give me a complete recruitment report.",
];

interface AssistantPanelProps {
  open: boolean;
  messages: ChatMessage[];
  isSending: boolean;
  onClose: () => void;
  onSend: (question: string) => void;
  onRetry: (question: string) => void;
}

export function AssistantPanel({ open, messages, isSending, onClose, onSend, onRetry }: AssistantPanelProps) {
  const [inputValue, setInputValue] = useState("");
  const [mounted, setMounted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Entrance transition (respects prefers-reduced-motion via the
  // motion-reduce: variant below, same pattern as card.tsx's existing hover
  // lift) -- flips from the "hidden" position/opacity to the resting one
  // one frame after mount so the browser actually animates the transition
  // instead of starting already at its end state.
  useEffect(() => {
    if (!open) {
      setMounted(false);
      return;
    }
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    // Guarded (not just optional-chained on the ref) because jsdom -- this
    // app's test environment -- doesn't implement Element.scrollTo, unlike
    // a real browser; a plain scrollTop assignment as the fallback still
    // gets every real user to the latest message, just without the smooth
    // animation.
    const el = scrollRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  if (!open) return null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed || isSending) return;
    onSend(trimmed);
    setInputValue("");
  }

  return (
    <div
      role="dialog"
      aria-label="SIMATS Recruitment Assistant"
      className={cn(
        "fixed inset-0 z-50 flex flex-col overflow-hidden bg-card text-card-foreground shadow-[var(--shadow-card)] transition-all duration-300 ease-out motion-reduce:transition-none",
        "sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[min(720px,calc(100vh-7rem))] sm:w-[400px] sm:rounded-[var(--radius-card)] sm:border sm:border-border",
        mounted ? "translate-y-0 opacity-100 sm:translate-x-0" : "translate-y-4 opacity-0 sm:translate-x-8",
      )}
    >
      <div className="flex items-center justify-between gap-3 bg-sidebar-background px-4 py-3.5 text-sidebar-foreground">
        <div>
          <h2 className="text-sm font-semibold">SIMATS Recruitment Assistant</h2>
          <p className="text-xs text-sidebar-foreground-muted">Ask about vacancies, recruitment and workforce data</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-sidebar-foreground hover:bg-white/10 hover:text-sidebar-foreground"
          onClick={onClose}
          aria-label="Close assistant"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto bg-muted/30 px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">Try asking:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => onSend(question)}
                  disabled={isSending}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-left text-xs text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <AssistantMessage key={message.id} message={message} onRetry={onRetry} onNavigate={onClose} />
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-border bg-card p-3">
        <Input
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="Ask about vacancies, recruitment..."
          disabled={isSending}
          aria-label="Message"
        />
        <Button type="submit" size="icon" disabled={isSending || !inputValue.trim()} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
