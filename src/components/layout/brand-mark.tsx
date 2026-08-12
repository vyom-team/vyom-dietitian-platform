import { Leaf } from "lucide-react";

import { cn } from "@/lib/utils";
import { siteConfig } from "@/config/site";

/**
 * Wordmark. A placeholder glyph stands in until brand assets exist; it is the
 * only decorative mark in the product.
 */
export function BrandMark({
  className,
  showName = true,
}: {
  className?: string;
  showName?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Leaf className="size-4" aria-hidden="true" />
      </span>
      {showName ? (
        <span className="font-heading text-base font-semibold tracking-tight">
          {siteConfig.name}
        </span>
      ) : null}
    </span>
  );
}
