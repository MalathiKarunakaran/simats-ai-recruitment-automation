import { CalendarDays } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface DateRangeValue {
  startDate: string | null;
  endDate: string | null;
}

interface DateRangeControlProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function presetRange(preset: "today" | "week" | "month"): DateRangeValue {
  const now = new Date();
  if (preset === "today") {
    const today = toIsoDate(now);
    return { startDate: today, endDate: today };
  }
  if (preset === "week") {
    const dayOfWeek = now.getDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysSinceMonday);
    return { startDate: toIsoDate(monday), endDate: toIsoDate(now) };
  }
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return { startDate: toIsoDate(firstOfMonth), endDate: toIsoDate(now) };
}

function formatLabel(value: DateRangeValue): string {
  if (!value.startDate && !value.endDate) return "All time";
  if (value.startDate === value.endDate) return value.startDate ?? "—";
  return `${value.startDate ?? "…"} – ${value.endDate ?? "…"}`;
}

export function DateRangeControl({ value, onChange }: DateRangeControlProps) {
  const [open, setOpen] = useState(false);
  const [customStart, setCustomStart] = useState(value.startDate ?? "");
  const [customEnd, setCustomEnd] = useState(value.endDate ?? "");

  function applyPreset(preset: "today" | "week" | "month") {
    onChange(presetRange(preset));
    setOpen(false);
  }

  function clearRange() {
    onChange({ startDate: null, endDate: null });
    setOpen(false);
  }

  function applyCustom() {
    onChange({ startDate: customStart || null, endDate: customEnd || null });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <CalendarDays className="h-3.5 w-3.5" />
          {formatLabel(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <div className="flex flex-col gap-0.5">
          <Button variant="ghost" size="sm" className="justify-start" onClick={clearRange}>
            All time
          </Button>
          <Button variant="ghost" size="sm" className="justify-start" onClick={() => applyPreset("today")}>
            Today
          </Button>
          <Button variant="ghost" size="sm" className="justify-start" onClick={() => applyPreset("week")}>
            This week
          </Button>
          <Button variant="ghost" size="sm" className="justify-start" onClick={() => applyPreset("month")}>
            This month
          </Button>
        </div>
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
          <Label className="text-xs text-muted-foreground">Custom range</Label>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="h-8 text-xs"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <Button size="sm" disabled={!customStart && !customEnd} onClick={applyCustom}>
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
