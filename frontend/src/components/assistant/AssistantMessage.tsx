import { AlertCircle, Download, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import remarkGfm from "remark-gfm";

import { downloadAssistantExport } from "@/api/assistant";
import type { AssistantAction } from "@/api/types";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ChatMessage } from "./types";

// Markdown-table styling mirrors components/ui/table.tsx's own class
// vocabulary exactly (--muted-tinted header row, divide-y divide-border
// rows, text-table-header sizing) so an assistant answer's table reads as
// this app's table, not a foreign one -- just without that primitive's
// sort-button machinery, which a markdown table has no use for.
const MARKDOWN_COMPONENTS = {
  table: (props: ComponentPropsWithoutRef<"table">) => (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs" {...props} />
    </div>
  ),
  thead: (props: ComponentPropsWithoutRef<"thead">) => (
    <thead className="border-b border-border bg-muted/50 text-left text-muted-foreground" {...props} />
  ),
  tbody: (props: ComponentPropsWithoutRef<"tbody">) => <tbody className="divide-y divide-border" {...props} />,
  th: (props: ComponentPropsWithoutRef<"th">) => (
    <th className="px-2 py-1.5 text-table-header font-medium whitespace-nowrap" {...props} />
  ),
  td: (props: ComponentPropsWithoutRef<"td">) => <td className="px-2 py-1.5 whitespace-nowrap" {...props} />,
  p: (props: ComponentPropsWithoutRef<"p">) => <p className="mb-2 leading-relaxed last:mb-0" {...props} />,
  ul: (props: ComponentPropsWithoutRef<"ul">) => <ul className="mb-2 list-disc pl-5 last:mb-0" {...props} />,
  ol: (props: ComponentPropsWithoutRef<"ol">) => <ol className="mb-2 list-decimal pl-5 last:mb-0" {...props} />,
  code: (props: ComponentPropsWithoutRef<"code">) => (
    <code className="rounded bg-muted px-1 py-0.5 text-xs" {...props} />
  ),
  a: (props: ComponentPropsWithoutRef<"a">) => (
    <a className="text-brand-primary underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />
  ),
};

type ExportState = "idle" | "loading" | "success" | "error";

function ActionButtons({ actions, onNavigate }: { actions: AssistantAction[]; onNavigate: () => void }) {
  const [exportState, setExportState] = useState<Record<number, ExportState>>({});
  const [exportError, setExportError] = useState<Record<number, string>>({});

  async function handleExport(action: AssistantAction, index: number) {
    if (!action.report_type) return;
    setExportState((prev) => ({ ...prev, [index]: "loading" }));
    try {
      await downloadAssistantExport(action.report_type, action.params ?? {});
      setExportState((prev) => ({ ...prev, [index]: "success" }));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Export failed. Please try again.";
      setExportError((prev) => ({ ...prev, [index]: message }));
      setExportState((prev) => ({ ...prev, [index]: "error" }));
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {actions.map((action, index) => {
        if (action.type === "open_page") {
          const search = action.query ? `?${new URLSearchParams(action.query).toString()}` : "";
          return (
            <Button key={`${action.type}-${index}`} asChild size="sm" variant="outline" onClick={onNavigate}>
              <Link to={`${action.path ?? "/"}${search}`}>
                <ExternalLink className="h-3.5 w-3.5" />
                {action.label}
              </Link>
            </Button>
          );
        }

        const state = exportState[index] ?? "idle";
        return (
          <div key={`${action.type}-${index}`} className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              disabled={state === "loading"}
              onClick={() => void handleExport(action, index)}
            >
              {state === "loading" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {action.label}
            </Button>
            {state === "success" ? <span className="text-xs text-brand-success">Downloaded</span> : null}
            {state === "error" ? <span className="text-xs text-destructive">{exportError[index]}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export function AssistantMessage({
  message,
  onRetry,
  onNavigate,
}: {
  message: ChatMessage;
  onRetry: (question: string) => void;
  onNavigate: () => void;
}) {
  const isUser = message.role === "user";

  if (message.status === "pending") {
    return (
      <div className="flex justify-start">
        <div className="flex items-center gap-2 rounded-2xl bg-card px-4 py-2.5 text-sm text-muted-foreground shadow-[var(--shadow-card)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Thinking…
        </div>
      </div>
    );
  }

  if (message.status === "error") {
    return (
      <div className="flex justify-start">
        <div className="flex max-w-[85%] flex-col gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{message.content}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-fit border-destructive/40 text-destructive hover:bg-destructive/10"
            onClick={() => onRetry(message.question ?? "")}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
          isUser
            ? "bg-brand-primary text-primary-foreground"
            : "bg-card text-card-foreground shadow-[var(--shadow-card)]",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="[&>*:last-child]:mb-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        {message.actions && message.actions.length > 0 ? (
          <ActionButtons actions={message.actions} onNavigate={onNavigate} />
        ) : null}
      </div>
    </div>
  );
}
