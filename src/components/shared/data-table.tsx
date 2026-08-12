import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type Column<T> = {
  /** Stable key, also used as the React key. */
  id: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** Right-aligned, for numbers and action columns. */
  align?: "start" | "end";
  /** Hidden below the `md` breakpoint to keep small screens readable. */
  hideOnMobile?: boolean;
  width?: string;
};

type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  /** Shown in place of the body when `rows` is empty. */
  emptyState?: React.ReactNode;
  caption?: string;
  className?: string;
};

/**
 * Table shell.
 *
 * Presentation only — sorting, pagination, and selection are added when a real
 * data source exists and the requirements are known. On small screens the
 * container scrolls horizontally and `hideOnMobile` columns drop out.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  emptyState,
  caption,
  className,
}: DataTableProps<T>) {
  if (rows.length === 0 && emptyState) {
    return (
      <div className={cn("rounded-xl border bg-card", className)}>
        {emptyState}
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      <Table>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => (
              <TableHead
                key={column.id}
                style={column.width ? { width: column.width } : undefined}
                className={cn(
                  "type-caption h-10 font-medium",
                  column.align === "end" && "text-right",
                  column.hideOnMobile && "hidden md:table-cell",
                )}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={getRowId(row)}>
              {columns.map((column) => (
                <TableCell
                  key={column.id}
                  className={cn(
                    "py-3",
                    column.align === "end" && "text-right",
                    column.hideOnMobile && "hidden md:table-cell",
                  )}
                >
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function DataTableSkeleton({
  columns = 4,
  rows = 5,
}: {
  columns?: number;
  rows?: number;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-4 border-b px-4 py-3">
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={index} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="flex items-center gap-4 px-4 py-4">
            {Array.from({ length: columns }).map((_, cellIndex) => (
              <Skeleton key={cellIndex} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
      <span className="sr-only">Loading table data</span>
    </div>
  );
}
