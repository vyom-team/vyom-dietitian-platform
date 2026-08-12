import { cn } from "@/lib/utils";

type ContainerProps = React.ComponentProps<"div"> & {
  /**
   * Maximum content width.
   * - `default` — standard application pages
   * - `wide` — dense tables and dashboards
   * - `narrow` — forms and reading-oriented content
   */
  width?: "default" | "wide" | "narrow";
};

const widths = {
  default: "max-w-6xl",
  wide: "max-w-7xl",
  narrow: "max-w-3xl",
} as const;

/**
 * Horizontal page container. The single source of truth for page gutters and
 * max width, so pages stay aligned without repeating layout classes.
 */
export function Container({
  className,
  width = "default",
  ...props
}: ContainerProps) {
  return (
    <div
      className={cn("mx-auto w-full px-4 sm:px-6 lg:px-8", widths[width], className)}
      {...props}
    />
  );
}
