import { ImageOff } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface ProductThumbnailProps {
  src: string | null;
  /** Tried once if `src` fails to load (e.g. the small original of an enlarged eBay picture). */
  fallbackSrc?: string | null;
  alt: string;
  /**
   * "thumb":   fixed small square, cropped.
   * "cover":   fills the container width as a square, cropped (product cards).
   * "natural": original proportions, never cropped; as wide as the container allows,
   *            capped at a max height (details page).
   */
  variant?: "thumb" | "cover" | "natural";
  className?: string;
}

const BOX: Record<NonNullable<ProductThumbnailProps["variant"]>, string> = {
  thumb: "size-10 rounded-md border bg-muted",
  cover: "aspect-square w-full bg-muted",
  natural: "w-full",
};

export function ProductThumbnail({ src: primary, fallbackSrc, alt, variant = "thumb", className }: ProductThumbnailProps) {
  // 0 = showing `src`, 1 = showing `fallbackSrc`, 2 = nothing loads.
  const [attempt, setAttempt] = useState(0);
  const sources = [primary, fallbackSrc].filter((value): value is string => Boolean(value));
  const src = sources[attempt] ?? null;
  const failed = attempt >= sources.length;
  const box = cn("flex shrink-0 items-center justify-center overflow-hidden", BOX[variant], className);

  if (!src || failed) {
    return (
      <div
        className={cn(box, variant === "natural" && "aspect-[4/3] max-h-[32rem] rounded-lg border bg-muted")}
        aria-label="No image"
      >
        <ImageOff className={cn("text-muted-foreground", variant === "thumb" ? "size-4" : "size-8")} aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className={box}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        className={
          variant === "natural"
            ? // Intrinsic size, scaled down (never up) to fit the width and the max height.
              "h-auto max-h-[32rem] w-auto max-w-full rounded-lg object-contain"
            : "size-full object-cover"
        }
        onError={() => setAttempt((current) => current + 1)}
      />
    </div>
  );
}
