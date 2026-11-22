import * as React from "react";
import { cn } from "@/lib/utils";

/** Static loading placeholder (no pulse animation, per the "avoid unnecessary animations" rule). */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden="true" className={cn("rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };
