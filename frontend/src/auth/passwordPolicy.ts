import { minLength } from "@/hooks/useFieldValidation";
import type { Validator } from "@/hooks/useFieldValidation";

/**
 * The password policy (audit L2, 2026-09-04). One number, used by every
 * form that sets a password -- user creation, the forced-change screen,
 * Settings and the admin reset -- and mirrored by the backend's
 * PASSWORD_MIN_LENGTH in app/schemas/user.py, which is what actually
 * enforces it. Login is not affected: existing shorter passwords keep
 * working until they are changed.
 */
export const PASSWORD_MIN_LENGTH = 12;

export function passwordMinLength(): Validator<string> {
  return minLength(PASSWORD_MIN_LENGTH, `Must be at least ${PASSWORD_MIN_LENGTH} characters`);
}
