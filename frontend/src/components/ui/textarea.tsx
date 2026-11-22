import * as React from "react";
import { fieldBase } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldBase, "flex min-h-28 px-3.5 py-2.5 leading-relaxed", className)}
      {...props}
    />
  );
}

export { Textarea };
