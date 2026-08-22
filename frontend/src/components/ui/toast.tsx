import { CheckCircle2, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Design-system-foundation step 2 -- this is genuinely new (no toast library
// anywhere in this codebase today; forms currently show inline "Saved."
// text and a `<p className="text-destructive">` error banner -- see
// VacancyRequestEditPage/SettingsPage etc.). Dependency-free by design, same
// precedent as accordion.tsx/tabs.tsx (no @radix-ui/react-toast, no
// `sonner`) -- a plain React context + a fixed-position stack, nothing else.
// This step only builds and verifies the primitive (see toast.test.tsx);
// no existing page's inline "Saved."/error-banner pattern is migrated to it
// yet -- that's later-step work per the calling task's explicit scope.

export type ToastVariant = "success" | "error";

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  message: string;
  duration: number;
}

interface ToastContextValue {
  toasts: ToastItem[];
  showToast: (variant: ToastVariant, message: string, duration?: number) => string;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 5000;

// Plain incrementing counter rather than `crypto.randomUUID()` -- avoids
// depending on an API that may not exist in every target environment/test
// runner, and toasts never need cryptographic uniqueness, just uniqueness
// within the current tab's lifetime.
let toastIdCounter = 0;
function nextToastId(): string {
  toastIdCounter += 1;
  return `toast-${toastIdCounter}`;
}

// Mounted once at the app root (main.tsx), alongside ThemeProvider/
// QueryClientProvider/AuthProvider/CampusProvider -- available everywhere
// via useToast(), regardless of which route is active.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // Tracks setTimeout handles per toast id so dismissToast (manual dismiss,
  // or unmount) can clear a still-pending auto-dismiss timer instead of
  // leaking it / double-dismissing.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (variant: ToastVariant, message: string, duration = DEFAULT_DURATION_MS) => {
      const id = nextToastId();
      setToasts((current) => [...current, { id, variant, message, duration }]);
      const timer = setTimeout(() => dismissToast(id), duration);
      timers.current.set(id, timer);
      return id;
    },
    [dismissToast],
  );

  // Clear every pending auto-dismiss timer if the provider itself unmounts
  // (in practice only in tests -- it's mounted once for the app's lifetime).
  useEffect(() => {
    const timersMap = timers.current;
    return () => {
      timersMap.forEach((timer) => clearTimeout(timer));
      timersMap.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
      <Toaster />
    </ToastContext.Provider>
  );
}

/**
 * `success`/`error` push a toast and return its id (for an early manual
 * `dismiss(id)` before its auto-dismiss timer fires); `dismiss` also accepts
 * any id returned by either. Usage:
 * ```tsx
 * const { success, error } = useToast();
 * success("Saved.");
 * error("Could not save changes.");
 * ```
 */
export function useToast(): {
  success: (message: string, duration?: number) => string;
  error: (message: string, duration?: number) => string;
  dismiss: (id: string) => void;
} {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return {
    success: (message: string, duration?: number) => context.showToast("success", message, duration),
    error: (message: string, duration?: number) => context.showToast("error", message, duration),
    dismiss: context.dismissToast,
  };
}

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: "border-brand-success/30",
  error: "border-destructive/40",
};

// Rendered once by ToastProvider itself, not a separate call site each
// caller has to remember to mount -- consistent with this file only ever
// needing ONE stack for the whole app.
function Toaster() {
  const context = useContext(ToastContext);
  if (!context || context.toasts.length === 0) return null;
  const { toasts, dismissToast } = context;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className={cn(
            "pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-card px-4 py-3 text-sm text-foreground shadow-[var(--shadow-card-hover)]",
            VARIANT_STYLES[toast.variant],
          )}
        >
          {toast.variant === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-success" aria-hidden="true" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          )}
          <p className="flex-1">{toast.message}</p>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss notification"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
