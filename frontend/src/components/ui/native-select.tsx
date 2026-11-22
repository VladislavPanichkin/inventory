import * as React from "react";
import { ChevronDown } from "lucide-react";
import { fieldBase } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Styled native <select>. Chosen over a custom listbox: fully accessible,
 * keyboard/touch friendly on mobile, and no extra dependency.
 */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select
        data-slot="native-select"
        className={cn(fieldBase, "h-11 cursor-pointer appearance-none py-2 pl-3.5 pr-10")}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export { NativeSelect };
