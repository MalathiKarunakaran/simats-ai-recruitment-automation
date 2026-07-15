import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      default: "border-transparent bg-secondary text-secondary-foreground",
      outline: "border-border text-foreground",
      success: "border-transparent bg-brand-green/15 text-brand-green dark:bg-brand-green/20 dark:text-[#7bd987]",
      warning: "border-transparent bg-brand-orange/15 text-brand-orange dark:bg-brand-orange/20 dark:text-[#ffab66]",
      destructive: "border-transparent bg-destructive text-destructive-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
