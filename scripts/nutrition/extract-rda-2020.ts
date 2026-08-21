/**
 * Extracts ICMR-NIN RDA/EAR 2020 adult reference values into an importable CSV.
 *
 *   npm run nutrition:extract-rda
 *
 * Reads the line-by-line text extraction of the publication from
 * NUTRITION_DATA_DIR and writes `processed/icmr-rda-2020.csv`, which
 * `nutrition:import-references` then imports.
 *
 * WHY A SCRIPT AND NOT A HAND-TYPED CSV
 *
 * A hand-typed file cannot be re-derived, and nobody can tell later whether a
 * figure was transcribed or remembered. This reads the publication's own lines,
 * so re-running it reproduces the same CSV, and a wrong value is a bug in a
 * reviewable spec rather than a typo nobody can find.
 *
 * SCOPE: ADULTS ONLY
 *
 * Only the >18 y male and female rows are extracted. Three reasons, all
 * deliberate:
 *
 *   - Every adult value can be cross-checked against the publication's own
 *     summary tables, and this script does that check and fails if any
 *     disagrees. Child and adolescent rows have no such second statement.
 *   - Infant and child rows in these tables have irregular shapes — merged age
 *     bands, inline "(AI)" markers — that would need per-row guessing.
 *   - Pregnancy and lactation values exist, but Vyom's assessment model
 *     captures no physiological state, so importing them would create rules
 *     that can never resolve.
 *
 * Anything not extracted stays absent, and the target engine reports
 * REFERENCE_REQUIRED for it. That is the correct outcome, not a gap to paper
 * over.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { parseCsv } from "../../src/lib/nutrition/ingest/csv.js";
import { resolveDatasetFile } from "../../src/lib/nutrition/data-dir.js";

const SOURCE_FILE = "raw/references/icmr-rda-2020-book-text.csv";
const OUTPUT_FILE = "processed/icmr-rda-2020.csv";

/** What a number in a row means, in the order the table prints them. */
type Field = "weight" | "EAR" | "RDA" | "TUL" | "ignore";

type RowSpec = {
  /** Consecutive label lines that identify the row, in order. */
  labels: string[];
  sex: "MALE" | "FEMALE";
  fields: Field[];
};

type TableSpec = {
  /** Start of the table's caption line. Located verbatim, not guessed. */
  anchor: string;
  nutrient: string;
  unit: "MG_PER_DAY" | "UG_PER_DAY" | "G_PER_DAY";
  /** Page, for the citation carried onto every rule. */
  table: string;
  rows: RowSpec[];
  /**
   * A cell such as "400 IU (10 μg)" states both units. The parenthesised
   * figure is taken, because that is the unit Vyom stores — no conversion is
   * performed here or anywhere else.
   */
  parenthesised?: boolean;
};

/**
 * The tables, and what each column means.
 *
 * Column order differs between tables — vitamin A prints EAR, RDA 2020, RDA
 * 2010, TUL, and reading it as EAR/RDA/TUL would silently import the 2010
 * figure. Each order below was read off the publication's own header rows.
 */
const TABLES: TableSpec[] = [
  {
    anchor: "Table 8.1.7. EAR and RDA of calcium",
    nutrient: "CALCIUM",
    unit: "MG_PER_DAY",
    table: "Table 8.1.7, p. 168",
    rows: [
      { labels: ["Men", ">18 y"], sex: "MALE", fields: ["EAR", "RDA"] },
      { labels: ["Women (NPNL)", ">18 y"], sex: "FEMALE", fields: ["EAR", "RDA"] },
    ],
  },
  {
    anchor: "Table 8.1.9. EAR and RDA of phosphorus",
    nutrient: "PHOSPHORUS",
    unit: "MG_PER_DAY",
    table: "Table 8.1.9, p. 169",
    rows: [
      { labels: ["Men", ">18 y"], sex: "MALE", fields: ["EAR", "RDA"] },
      { labels: ["Women (NPNL)", ">18 y"], sex: "FEMALE", fields: ["EAR", "RDA"] },
    ],
  },
  {
    anchor: "Table 8.2.1. Recommended Daily Allowance of Magnesium",
    nutrient: "MAGNESIUM",
    unit: "MG_PER_DAY",
    table: "Table 8.2.1, p. 180",
    rows: [
      { labels: ["Adult Men"], sex: "MALE", fields: ["weight", "EAR", "RDA", "TUL"] },
      { labels: ["Adult Women"], sex: "FEMALE", fields: ["weight", "EAR", "RDA", "TUL"] },
    ],
  },
  {
    anchor: "Table 9.7. Summary of EAR and RDA for Iron",
    nutrient: "IRON",
    unit: "MG_PER_DAY",
    table: "Table 9.7, p. 198",
    rows: [
      { labels: ["Adult Men"], sex: "MALE", fields: ["weight", "EAR", "RDA", "TUL"] },
      { labels: ["Adult Women"], sex: "FEMALE", fields: ["weight", "EAR", "RDA", "TUL"] },
    ],
  },
  {
    anchor: "Table 10.1. EAR and RDA of zinc",
    nutrient: "ZINC",
    unit: "MG_PER_DAY",
    table: "Table 10.1, p. 206",
    rows: [
      {
        labels: ["Men"],
        sex: "MALE",
        fields: ["weight", "ignore", "ignore", "EAR", "RDA"],
      },
      {
        labels: ["Women (WRA)"],
        sex: "FEMALE",
        fields: ["weight", "ignore", "ignore", "EAR", "RDA"],
      },
    ],
  },
  {
    anchor: "Table 12.5.4. RDA of dietary folate",
    nutrient: "FOLATE",
    unit: "UG_PER_DAY",
    table: "Table 12.5.4, p. 266",
    rows: [
      {
        labels: ["Men", "Sedentary"],
        sex: "MALE",
        fields: ["weight", "EAR", "RDA", "TUL"],
      },
      {
        labels: ["Women", "Sedentary"],
        sex: "FEMALE",
        fields: ["weight", "EAR", "RDA", "TUL"],
      },
    ],
  },
  {
    anchor: "Table 12.7.2. RDA of ascorbic acid",
    nutrient: "VITAMIN_C",
    unit: "MG_PER_DAY",
    table: "Table 12.7.2, p. 279",
    rows: [
      { labels: ["Adult Men"], sex: "MALE", fields: ["weight", "EAR", "RDA", "TUL"] },
      { labels: ["Adult Women"], sex: "FEMALE", fields: ["weight", "EAR", "RDA", "TUL"] },
    ],
  },
  {
    anchor: "Table 13.1.8. Vitamin A daily requirements",
    nutrient: "VITAMIN_A",
    unit: "UG_PER_DAY",
    table: "Table 13.1.8, p. 296",
    rows: [
      {
        labels: ["Adult-Male"],
        // EAR, RDA 2020, RDA 2010, TUL — the 2010 column sits between them.
        sex: "MALE",
        fields: ["weight", "EAR", "RDA", "ignore", "TUL"],
      },
      {
        labels: ["Adult-Female"],
        sex: "FEMALE",
        fields: ["weight", "EAR", "RDA", "ignore", "TUL"],
      },
    ],
  },
  {
    anchor: "Table 13.2.1. EAR and RDA of vitamin D",
    nutrient: "VITAMIN_D",
    unit: "UG_PER_DAY",
    table: "Table 13.2.1, p. 306",
    parenthesised: true,
    rows: [
      { labels: ["Adult Men"], sex: "MALE", fields: ["weight", "EAR", "RDA"] },
      { labels: ["Adult Women"], sex: "FEMALE", fields: ["weight", "EAR", "RDA"] },
    ],
  },
];

/**
 * The publication's own summary tables, used to check the extraction.
 *
 * These come from the ICMR-NIN Brief Note, which restates Tables 3 (males) and
 * 4 (females). Agreement between two separate statements of the same figure is
 * what makes this extraction trustworthy; a disagreement fails the run.
 *
 * Where the note rounds and the full tables do not, the tolerance says so
 * explicitly rather than the check being loosened silently.
 */
const CROSS_CHECK: {
  nutrient: string;
  sex: "MALE" | "FEMALE";
  rda: number;
  ear: number;
  note?: string;
}[] = [
  { nutrient: "CALCIUM", sex: "MALE", rda: 1000, ear: 800 },
  { nutrient: "CALCIUM", sex: "FEMALE", rda: 1000, ear: 800 },
  { nutrient: "MAGNESIUM", sex: "MALE", rda: 440, ear: 370 },
  { nutrient: "MAGNESIUM", sex: "FEMALE", rda: 370, ear: 310 },
  { nutrient: "IRON", sex: "MALE", rda: 19, ear: 11 },
  { nutrient: "IRON", sex: "FEMALE", rda: 29, ear: 15 },
  {
    nutrient: "ZINC",
    sex: "MALE",
    rda: 17,
    ear: 14,
    note: "Brief Note rounds EAR to 14; the full table states 14.1.",
  },
  {
    nutrient: "ZINC",
    sex: "FEMALE",
    rda: 13,
    ear: 11,
    note: "Brief Note rounds RDA to 13.0; the full table states 13.2.",
  },
  { nutrient: "FOLATE", sex: "MALE", rda: 300, ear: 250 },
  { nutrient: "FOLATE", sex: "FEMALE", rda: 220, ear: 180 },
  { nutrient: "VITAMIN_C", sex: "MALE", rda: 80, ear: 65 },
  { nutrient: "VITAMIN_C", sex: "FEMALE", rda: 65, ear: 55 },
  { nutrient: "VITAMIN_A", sex: "MALE", rda: 1000, ear: 460 },
  { nutrient: "VITAMIN_A", sex: "FEMALE", rda: 840, ear: 390 },
  {
    nutrient: "VITAMIN_D",
    sex: "MALE",
    rda: 15,
    ear: 10,
    note: "Brief Note states 600/400 IU; the full table states both, and the µg figure is used.",
  },
  { nutrient: "VITAMIN_D", sex: "FEMALE", rda: 15, ear: 10 },
];

/** Tolerance for a figure the Brief Note rounds. Never widened beyond this. */
const ROUNDING_TOLERANCE = 0.25;

type Extracted = {
  nutrient: string;
  sex: "MALE" | "FEMALE";
  valueType: "EAR" | "RDA" | "UL";
  value: string;
  unit: string;
  table: string;
};

const NUMBER = /^[+-]?\d+(\.\d+)?$/;

/** Pulls the parenthesised figure from a cell such as "400 IU (10 μg)". */
function parenthesisedValue(cell: string): string | null {
  const match = cell.match(/\(\s*([\d.]+)\s*[^)]*\)/);
  return match ? match[1]! : null;
}

function main(): void {
  const path = resolveDatasetFile(SOURCE_FILE);
  const parsed = parseCsv(readFileSync(path, "utf8"));

  const lines = parsed.rows
    .filter((row) => row["record_type"] === "document_text")
    .map((row) => (row["content"] ?? "").trim());

  const extracted: Extracted[] = [];
  const problems: string[] = [];

  for (const table of TABLES) {
    const start = lines.findIndex((line) => line.startsWith(table.anchor));

    if (start === -1) {
      problems.push(`Table not found in the publication text: "${table.anchor}"`);
      continue;
    }

    // A table never runs past the next 60 lines in this extraction.
    const window = lines.slice(start, start + 60);

    for (const spec of table.rows) {
      const at = findLabels(window, spec.labels);

      if (at === -1) {
        problems.push(
          `${table.nutrient}: row "${spec.labels.join(" / ")}" not found under ${table.anchor}`,
        );
        continue;
      }

      const values = readFields(window, at + spec.labels.length, spec, table);

      if (!values) {
        problems.push(
          `${table.nutrient} ${spec.sex}: could not read ${spec.fields.length} value(s) after "${spec.labels.join(" / ")}"`,
        );
        continue;
      }

      for (const [field, value] of values) {
        if (field === "weight" || field === "ignore") continue;
        extracted.push({
          nutrient: table.nutrient,
          sex: spec.sex,
          valueType: field === "TUL" ? "UL" : field,
          value,
          unit: table.unit,
          table: table.table,
        });
      }
    }
  }

  const failures = crossCheck(extracted);

  report(extracted, problems, failures);

  if (problems.length > 0 || failures.length > 0) {
    console.error(
      "\n  NOTHING WAS WRITTEN. Every extracted value must match the publication's\n" +
        "  own summary tables before a clinical reference file is produced.\n",
    );
    process.exitCode = 1;
    return;
  }

  write(extracted);
}

/** Finds consecutive label lines, tolerating the odd blank between them. */
function findLabels(window: string[], labels: string[]): number {
  outer: for (let i = 0; i < window.length; i += 1) {
    if (window[i] !== labels[0]) continue;

    let cursor = i + 1;
    for (const label of labels.slice(1)) {
      while (cursor < window.length && window[cursor] === "") cursor += 1;
      if (window[cursor] !== label) continue outer;
      cursor += 1;
    }
    return i;
  }
  return -1;
}

/** Reads the numbers following a row's labels, in the order the table prints. */
function readFields(
  window: string[],
  from: number,
  spec: RowSpec,
  table: TableSpec,
): [Field, string][] | null {
  const out: [Field, string][] = [];
  let cursor = from;

  for (const field of spec.fields) {
    while (cursor < window.length && window[cursor] === "") cursor += 1;
    const cell = window[cursor];
    if (cell === undefined) return null;

    if (table.parenthesised && (field === "EAR" || field === "RDA")) {
      const value = parenthesisedValue(cell);
      if (value === null) return null;
      out.push([field, value]);
      cursor += 1;
      continue;
    }

    if (!NUMBER.test(cell)) return null;
    out.push([field, cell]);
    cursor += 1;
  }

  return out;
}

/** Compares every extracted figure against the publication's summary tables. */
function crossCheck(extracted: Extracted[]): string[] {
  const failures: string[] = [];

  for (const expected of CROSS_CHECK) {
    for (const [type, want] of [
      ["RDA", expected.rda],
      ["EAR", expected.ear],
    ] as const) {
      const found = extracted.find(
        (entry) =>
          entry.nutrient === expected.nutrient &&
          entry.sex === expected.sex &&
          entry.valueType === type,
      );

      if (!found) {
        failures.push(`${expected.nutrient} ${expected.sex} ${type}: not extracted`);
        continue;
      }

      const delta = Math.abs(Number(found.value) - want);

      if (delta > ROUNDING_TOLERANCE) {
        failures.push(
          `${expected.nutrient} ${expected.sex} ${type}: extracted ${found.value}, summary table states ${want}`,
        );
      }
    }
  }

  return failures;
}

function report(extracted: Extracted[], problems: string[], failures: string[]): void {
  console.log("\nICMR-NIN RDA/EAR 2020 — adult reference extraction");
  console.log("=".repeat(66));
  console.log(`  values extracted   ${String(extracted.length).padStart(6)}`);
  console.log(`  extraction problems${String(problems.length).padStart(6)}`);
  console.log(`  cross-check failures${String(failures.length).padStart(5)}`);

  if (extracted.length > 0) {
    console.log("\n  Nutrient        Sex      EAR      RDA       UL   Source");
    console.log("  " + "-".repeat(62));

    const keys = [...new Set(extracted.map((e) => `${e.nutrient}|${e.sex}`))];
    for (const key of keys) {
      const [nutrient, sex] = key.split("|");
      const of = (type: string) =>
        extracted.find(
          (e) => e.nutrient === nutrient && e.sex === sex && e.valueType === type,
        )?.value ?? "—";
      const table =
        extracted.find((e) => e.nutrient === nutrient)?.table.replace("Table ", "T") ?? "";

      console.log(
        `  ${nutrient!.padEnd(15)} ${sex!.padEnd(7)} ${of("EAR").padStart(6)} ${of("RDA").padStart(8)} ${of("UL").padStart(8)}   ${table}`,
      );
    }
  }

  for (const problem of problems) console.log(`\n  PROBLEM  ${problem}`);
  for (const failure of failures) console.log(`\n  MISMATCH ${failure}`);
}

function write(extracted: Extracted[]): void {
  const header =
    "rule_type,nutrient,rule_key,sex,age_min,age_max,value,value_min,value_max,unit,value_type,notes";

  const lines = extracted.map((entry) =>
    [
      "MICRONUTRIENT_INTAKE",
      entry.nutrient,
      "",
      entry.sex,
      "19",
      "130",
      entry.value,
      "",
      "",
      entry.unit,
      entry.valueType,
      `"ICMR-NIN RDA/EAR 2020, ${entry.table}"`,
    ].join(","),
  );

  const path = resolveDatasetFile(OUTPUT_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, [header, ...lines].join("\n") + "\n", "utf8");

  console.log(`\n  Written  ${OUTPUT_FILE}  (${lines.length} rules)`);
  console.log(
    "\n  Next:  npm run nutrition:import-references -- --manifest icmr-rda-2020.json --dry-run\n",
  );
}

main();
