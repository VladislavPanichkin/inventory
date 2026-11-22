import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Shared look for text-like form controls (input, textarea, select):
 * 44px touch-friendly height, generous padding, 16px text (prevents iOS zoom on focus),
 * soft focus ring.
 */
export const fieldBase = cn(
  "w-full min-w-0 rounded-lg border border-input bg-card text-base shadow-xs outline-none",
  "transition-[color,border-color,box-shadow] placeholder:text-muted-foreground/70",
  "hover:border-ring/70",
  "focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/20",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-invalid:border-destructive aria-invalid:ring-destructive/15 aria-invalid:focus-visible:ring-destructive/20",
);

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(fieldBase, "flex h-11 px-3.5 py-2", className)}
      {...props}
    />
  );
}

export { Input };
