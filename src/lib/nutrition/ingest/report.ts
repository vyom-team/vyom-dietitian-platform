import type { Diagnostic, DiagnosticCode, ImportStatistics } from "./types";

/**
 * The import report.
 *
 * EVERY NUMBER HERE IS COUNTED, NEVER ESTIMATED.
 *
 * Each figure comes from work the importer actually did — rows it read, values
 * it wrote, cells it found blank. Nothing is derived from a file size or a
 * record count the dataset claims. A report that is occasionally invented is
 * worse than no report, because it is trusted.
 *
 * Formatting only. Nothing here touches the database or decides anything.
 */

export type ReportInput = {
  sourceCode: string;
  sourceName: string;
  version: string;
  fileName: string;
  checksum: string | null;
  dryRun: boolean;
  statistics: ImportStatistics;
  diagnostics: readonly Diagnostic[];
  startedAt: Date;
  completedAt: Date;
};

/** How many diagnostics of each code to show before summarising the rest. */
const SAMPLE_LIMIT = 5;

export function formatImportReport(input: ReportInput): string {
  const { statistics: stats } = input;
  const lines: string[] = [];

  const errors = input.diagnostics.filter((d) => d.severity === "error");
  const warnings = input.diagnostics.filter((d) => d.severity === "warning");

  lines.push("");
  lines.push("Nutrition Import Report");
  lines.push("=======================");
  lines.push("");
  lines.push(`  Source            ${input.sourceName} (${input.sourceCode})`);
  lines.push(`  Version           ${input.version}`);
  lines.push(`  File              ${input.fileName}`);
  if (input.checksum) lines.push(`  Checksum          sha256:${input.checksum}`);
  lines.push(`  Duration          ${duration(input.startedAt, input.completedAt)}`);
  if (input.dryRun) {
    lines.push("");
    lines.push("  DRY RUN — nothing was written to the database.");
  }

  lines.push("");
  lines.push("  Records");
  lines.push(`    Read            ${count(stats.recordsRead)}`);
  lines.push(`    Valid           ${count(stats.recordsValid)}`);
  lines.push(`    Invalid         ${count(stats.recordsInvalid)}`);
  lines.push(`    Skipped         ${count(stats.recordsSkipped)}`);
  lines.push(`    Imported        ${count(stats.recordsImported)}`);
  lines.push(`    Duplicate ids   ${count(stats.duplicateIdentifiers)}`);

  lines.push("");
  lines.push("  Foods");
  lines.push(`    Created         ${count(stats.foodsCreated)}`);
  lines.push(`    Matched         ${count(stats.foodsUpdated)}`);
  lines.push(`    Aliases         ${count(stats.aliasesWritten)}`);
  lines.push(`    Servings        ${count(stats.servingsWritten)}`);
  lines.push(
    `    ...no weight    ${count(stats.servingsWithoutWeight)}   (portion named, weight not established — never guessed)`,
  );

  lines.push("");
  lines.push("  Nutrient values");
  lines.push(`    Written         ${count(stats.nutrientValuesWritten)}`);
  // Named explicitly so the distinction is impossible to miss in a terminal.
  lines.push(
    `    Missing         ${count(stats.nutrientValuesMissing)}   (source published no value — stored as absent, not zero)`,
  );
  lines.push(`    Invalid         ${count(stats.nutrientValuesInvalid)}`);

  lines.push("");
  lines.push("  Source mapping");
  lines.push(`    Mapped          ${count(stats.mappingsMapped)}`);
  lines.push(`    Needs review    ${count(stats.mappingsNeedingReview)}`);
  lines.push(
    `    Unmapped cols   ${count(stats.unmappedNutrientColumns)}   (source nutrients Vyom has no home for — recorded, not dropped)`,
  );

  lines.push("");
  lines.push(`  Errors            ${count(errors.length)}`);
  lines.push(`  Warnings          ${count(warnings.length)}`);

  if (errors.length > 0) {
    lines.push("");
    lines.push("  Errors by kind");
    lines.push(...groupedSection(errors));
  }

  if (warnings.length > 0) {
    lines.push("");
    lines.push("  Warnings by kind");
    lines.push(...groupedSection(warnings));
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Groups diagnostics by code with a few examples each.
 *
 * A dataset with a mis-mapped column produces one diagnostic per row, and
 * printing ten thousand identical lines buries every other problem. The count
 * is exact; only the examples are truncated.
 */
function groupedSection(diagnostics: readonly Diagnostic[]): string[] {
  const grouped = new Map<DiagnosticCode, Diagnostic[]>();

  for (const diagnostic of diagnostics) {
    const bucket = grouped.get(diagnostic.code);
    if (bucket) bucket.push(diagnostic);
    else grouped.set(diagnostic.code, [diagnostic]);
  }

  const lines: string[] = [];
  const ordered = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length);

  for (const [code, items] of ordered) {
    lines.push(`    ${code}  ×${items.length}`);
    for (const item of items.slice(0, SAMPLE_LIMIT)) {
      const where = item.row > 0 ? `row ${item.row}` : "file";
      const id = item.externalId ? ` [${item.externalId}]` : "";
      lines.push(`      ${where}${id}: ${item.message}`);
    }
    if (items.length > SAMPLE_LIMIT) {
      lines.push(`      … and ${items.length - SAMPLE_LIMIT} more`);
    }
  }

  return lines;
}

/**
 * The diagnostics to persist on the import manifest.
 *
 * Capped: one pathological file could otherwise write an unbounded JSON blob
 * into a database row. The counts in `statistics` remain exact — only the
 * stored examples are limited.
 */
export function diagnosticsForStorage(
  diagnostics: readonly Diagnostic[],
  severity: "error" | "warning",
  limit = 100,
): { total: number; sample: Diagnostic[] } {
  const matching = diagnostics.filter((d) => d.severity === severity);
  return { total: matching.length, sample: matching.slice(0, limit) };
}

function count(value: number): string {
  return value.toLocaleString("en-IN").padStart(7);
}

function duration(from: Date, to: Date): string {
  const ms = to.getTime() - from.getTime();
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
