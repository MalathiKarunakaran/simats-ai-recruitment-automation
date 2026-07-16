import { useState } from "react";

export type Validator<T> = (value: T) => string | null;

export interface FieldValidation<T> {
  value: T;
  error: string | null;
  onChange: (value: T) => void;
  onBlur: () => void;
  /** Runs the validator immediately, marks the field touched, and returns
   * whether it passed -- call on submit for fields the user never blurred. */
  validate: () => boolean;
}

/** Lightweight per-field validation: no schema library, just enough to show
 * required/invalid states inline instead of a single post-submit banner.
 * Errors only surface after the field is touched (blurred once, or the
 * form was submitted) so a fresh empty required field doesn't show red
 * before the user has had a chance to fill it in.
 *
 * String-specific rather than generic over T: a generic `useFieldValidation<T>("", ...)`
 * call infers T as the literal type `""` (not `string`) from the initial
 * value with no wider contextual type to widen against, which then rejects
 * any real typed string at onChange. Every field in this codebase is text
 * input anyway, so this sidesteps the inference problem instead of forcing
 * callers to annotate `<string>` at every call site. */
export function useFieldValidation(initialValue: string, validator: Validator<string>): FieldValidation<string> {
  const [value, setValue] = useState(initialValue);
  const [touched, setTouched] = useState(false);

  const rawError = validator(value);
  const error = touched ? rawError : null;

  function onChange(next: string) {
    setValue(next);
  }

  function onBlur() {
    setTouched(true);
  }

  function validate(): boolean {
    setTouched(true);
    return rawError === null;
  }

  return { value, error, onChange, onBlur, validate };
}

export function required(message = "Required"): Validator<string> {
  return (value) => (value.trim() ? null : message);
}

export function email(message = "Enter a valid email address"): Validator<string> {
  return (value) => (!value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : message);
}

export function minLength(min: number, message?: string): Validator<string> {
  return (value) => (!value || value.length >= min ? null : (message ?? `Must be at least ${min} characters`));
}

export function combine<T>(...validators: Validator<T>[]): Validator<T> {
  return (value) => {
    for (const validator of validators) {
      const result = validator(value);
      if (result) return result;
    }
    return null;
  };
}
