import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98]",
  {
    variants: {
      // "Secondary" in the design spec (white fill, bordered) is this
      // component's existing "outline" variant -- already visually
      // identical to spec, kept under its established name rather than
      // introducing a duplicate to avoid touching every call site.
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-brand-primary-hover dark:hover:brightness-110",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground hover:border-primary/40",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:brightness-90",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-6",
        // Circular per the design spec's "Icon Buttons: Circular".
        icon: "h-9 w-9 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Shows a spinner and disables the button -- opt-in, no existing call site is affected by adding this prop. */
  isLoading?: boolean;
}

function Button({ className, variant, size, asChild = false, isLoading = false, disabled, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(buttonVariants({ variant, size, className }))} disabled={disabled || isLoading} {...props}>
      {/* Radix Slot requires exactly one child expression -- asChild renders
          `children` completely unwrapped (e.g. <Button asChild><Link>...</Link></Button>);
          a real <button> gets an optional spinner composed alongside it via a
          single Fragment, never as sibling JSX expressions. */}
      {asChild ? (
        children
      ) : (
        <>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {children}
        </>
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
