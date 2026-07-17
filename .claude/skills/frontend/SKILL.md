---
name: frontend
description: React/Vite/TS frontend patterns for this repo -- the apiFetch client wrapper, the hand-written shadcn/ui-style component kit, role-gating conventions, and the useFieldValidation hook. Load when writing or reviewing a page, component, hook, or API module in frontend/src/.
---

# Frontend patterns (SIMATS Recruitment)

## API layer (`frontend/src/api/`)

One typed module per backend resource (`vacancyRequests.ts`, `applications.ts`,
`offers.ts`, ...), each a thin set of async functions built on
`frontend/src/api/client.ts`'s three primitives:

- `apiFetch<T>(path, options)` — authenticated JSON calls. Attaches the
  in-memory access token (never localStorage — see `AuthContext`), and on a
  401 does exactly one silent refresh-then-retry (`_isRetry` guard prevents
  infinite recursion) before calling `authHooks.onAuthFailure()` and throwing
  `ApiError(401, "Session expired")`.
- `apiFetchBlob(path, options)` — same auth/retry logic, returns a `Blob`
  instead of parsed JSON (resume PDF downloads, Excel/PPTX exports).
- `publicFetch<T>(path, options)` — unauthenticated calls only (login, the raw
  refresh call itself) — must not go through `apiFetch` or it would recurse.

`ApiError` carries `.status`; `extractErrorMessage` reads the backend's
`{detail: string}` or `{detail: [{msg: ...}, ...]}` (422 validation) shape —
matches `HTTPException(detail=...)` on the backend exactly, so don't change
one side without the other. `API_BASE_URL` defaults to
`http://localhost:8000/api/v1`, overridable via `VITE_API_BASE_URL`.

Pattern for a new API module:
```ts
import { apiFetch } from "@/api/client";
import type { ThingRead, PaginatedResponse } from "@/api/types";

export async function listThings(): Promise<ThingRead[]> {
  const response = await apiFetch<PaginatedResponse<ThingRead>>(`/things?limit=200`);
  return response.items;
}
export async function getThing(id: string): Promise<ThingRead> {
  return apiFetch<ThingRead>(`/things/${id}`);
}
```

## Component kit (`frontend/src/components/ui/`)

Hand-written, shadcn/ui-style primitives (not the shadcn CLI/registry — no
`components.json`): `button.tsx`, `card.tsx`, `badge.tsx`, `input.tsx`,
`select.tsx`, `textarea.tsx`, `dialog.tsx`, `popover.tsx`, `label.tsx`. Each
Radix-based primitive (`select`, `dialog`, `popover`) wraps
`@radix-ui/react-*` and adds this repo's Tailwind classes via `cn()`
(`frontend/src/lib/utils.ts`, `clsx` + `tailwind-merge`). Variant components
(`button.tsx`) use `class-variance-authority`'s `cva()` for
`variant`/`size` props, e.g. `buttonVariants({variant: "outline", size: "sm"})`.
A new primitive should follow the same shape: a thin wrapper around the Radix
primitive, `cn(baseClasses, className)`, forwarded props via
`React.ComponentProps<typeof RadixPrimitive.X>`.

Feature (non-primitive) components live under `frontend/src/components/<domain>/`
(e.g. `applications/StatusBadge.tsx`, `candidates/ResumeUpload.tsx`,
`interviews/PanelMemberPicker.tsx`) — one folder per backend resource domain,
mirroring `frontend/src/api/`.

## Role-gating (client-side mirror, not the security boundary)

`frontend/src/components/layout/AppShell.tsx`'s `NAV_ITEMS` array has an
optional `visibleForRoles: string[]` per item; nav links are filtered by
`user.role` before render. Each entry is commented with which backend gate it
mirrors (e.g. Offers nav → `offers.py`'s HR_ADMIN/SUPER_ADMIN/MANAGEMENT
gate). Page-level components repeat this same pattern locally (e.g.
`VacancyApprovalsPage`'s `ACTIONABLE_STATUSES_BY_ROLE`,
`OnboardingListPage`'s `CAN_VIEW_ROLES`). **When adding a new gated
endpoint, find its real role check in the backend router first, then mirror
that exact role set here — never invent a client-side-only permission
scheme.** The backend re-checks everything regardless; this is UX only.

## `useFieldValidation` (`frontend/src/hooks/useFieldValidation.ts`)

String-only (not generic) by design — a generic
`useFieldValidation<T>("", ...)` infers `T` as the literal type `""` from
the initial value with nothing to widen against, silently breaking
`onChange` at every call site (this was a real bug, fixed when `tsc -b
--force` was run correctly instead of the no-op `tsc --noEmit` — see
`CLAUDE.md`). Errors only surface after the field is touched (blur, or an
explicit `validate()` call on submit), not on a fresh empty required field.
Composable validators: `required()`, `email()`, `minLength(n)`,
`combine(...)`. Usage:
```ts
const title = useFieldValidation("", required());
<Input value={title.value} onChange={(e) => title.onChange(e.target.value)} onBlur={title.onBlur} />
{title.error && <p className="text-destructive text-sm">{title.error}</p>}
// on submit: if (!title.validate()) return;
```

## TypeScript build

`npx tsc -b --force` (project references — root `tsconfig.json` has
`files: []`), not `tsc --noEmit` which silently checks zero files. See
`CLAUDE.md` for the full footgun writeup.
