import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      default: "border-transparent bg-secondary text-secondary-foreground",
      outline: "border-brand-plum/40 bg-brand-plum/5 text-brand-plum dark:border-brand-plum/50 dark:text-brand-plum-bright",
      success: "border-transparent bg-brand-success/15 text-brand-success dark:bg-brand-success/20 dark:text-[#7bd987]",
      warning: "border-transparent bg-brand-warning/15 text-brand-warning dark:bg-brand-warning/20 dark:text-[#ffcc80]",
      destructive: "border-transparent bg-destructive text-destructive-foreground",
      info: "border-transparent bg-brand-info/15 text-brand-info dark:bg-brand-info/20 dark:text-[#93c5fd]",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
