import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";

/** Debounced search: the URL (and the request) moves 300ms after typing
 * stops, as on the Talent Pool register. */
interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}

export function SearchBox({ value, onChange, placeholder, label }: SearchBoxProps) {
  const [typed, setTyped] = useState(value);
  useEffect(() => setTyped(value), [value]);
  useEffect(() => {
    if (typed === value) return;
    const timer = setTimeout(() => onChange(typed), 300);
    return () => clearTimeout(timer);
  }, [typed, value, onChange]);

  return (
    <Input
      value={typed}
      onChange={(event) => setTyped(event.target.value)}
      placeholder={placeholder}
      aria-label={label}
      className="h-8 w-full max-w-xs text-xs"
    />
  );
}
