import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FoodSearchResult } from "@/services/nutrition/search";

/**
 * Food search results.
 *
 * Every row shows where its data came from. That is not decoration: these are
 * reference values a practitioner may act on, and "which dataset said this" is
 * part of the answer rather than a footnote. The same reasoning is why the
 * source badge is not tucked behind a tooltip.
 *
 * Serving sizes are shown when the source established one. Where it did not,
 * the cell says so rather than showing a plausible number — an unsourced
 * portion weight would be a fabricated figure in a clinical tool.
 */
export function FoodList({ foods }: { foods: FoodSearchResult[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-64">Food</TableHead>
            <TableHead className="min-w-40">Serving</TableHead>
            <TableHead className="w-28 text-right">Nutrients</TableHead>
            <TableHead className="min-w-32">Source</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {foods.map((food) => (
            <TableRow key={food.id}>
              <TableCell>
                <span className="font-medium">{food.canonicalName}</span>
                {food.preparationState !== "UNKNOWN" ? (
                  <Badge variant="outline" className="ml-2 align-middle">
                    {food.preparationState === "RAW" ? "Raw" : "Cooked"}
                  </Badge>
                ) : null}
              </TableCell>

              <TableCell className="type-caption">
                {food.servings.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  food.servings.slice(0, 1).map((serving) => (
                    <span key={serving.label}>
                      1 {serving.label}
                      {serving.weightGrams ? (
                        <span className="text-muted-foreground">
                          {" · "}
                          {formatGrams(serving.weightGrams)} g
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {" · "}weight not published
                        </span>
                      )}
                    </span>
                  ))
                )}
              </TableCell>

              <TableCell className="type-caption text-right tabular-nums">
                {food.nutrientCount}
              </TableCell>

              <TableCell className="type-caption">
                {food.source ? (
                  <span title={food.source.name}>
                    {food.source.code}{" "}
                    <span className="text-muted-foreground">{food.source.version}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Trims a stored decimal for display.
 *
 * Rounding happens here and nowhere earlier: the database keeps the value the
 * source implied, to three decimals, and the UI is the only layer entitled to
 * shorten it. A portion is not known to a thousandth of a gram, so showing one
 * would suggest a precision nobody has.
 */
function formatGrams(value: string): string {
  const grams = Number(value);
  if (!Number.isFinite(grams)) return value;
  return grams >= 10 ? String(Math.round(grams)) : grams.toFixed(1);
}
