import { describe, expect, it } from "vitest";

import { parseCsv } from "../src/lib/nutrition/ingest/csv";
import { normalizeRow, validateHeaders } from "../src/lib/nutrition/ingest/normalize";
import { formatImportReport } from "../src/lib/nutrition/ingest/report";
import { emptyStatistics } from "../src/lib/nutrition/ingest/types";
import { resolveDatasetFile } from "../src/lib/nutrition/data-dir";
import {
  datasetManifestSchema,
  parseDatasetManifest,
  type DatasetManifest,
} from "../src/validations/nutrition";

/**
 * The ingestion pipeline: parse → normalize → validate.
 *
 * ALL DATA IN THIS FILE IS SYNTHETIC. The values are deliberately absurd
 * ("11111"), and no row here is copied from IFCT, INDB, or any other published
 * table. These tests exercise the machinery, not any real nutrition figure.
 */

/** A minimal valid manifest, parsed so defaults are applied. */
function manifest(overrides: Record<string, unknown> = {}): DatasetManifest {
  return datasetManifestSchema.parse({
    source: "IFCT",
    version: "test-fixture",
    file: "fixture.csv",
    identifierColumn: "code",
    nameColumn: "name",
    nutrients: [
      { column: "energy", nutrient: "ENERGY", unit: "KCAL" },
      { column: "protein", nutrient: "PROTEIN", unit: "G" },
      { column: "iron", nutrient: "IRON", unit: "MG" },
    ],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe("CSV parsing", () => {
  it("reads a header and rows", () => {
    const parsed = parseCsv("code,name\nA1,Alpha\nA2,Beta\n");
    expect(parsed.headers).toEqual(["code", "name"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toEqual({ code: "A1", name: "Alpha" });
  });

  it("keeps every cell a string, so identifiers are not mangled", () => {
    // "007" must not become 7, and "0.30" must not become "0.3": a CSV reader
    // that infers types corrupts data before validation ever sees it.
    const parsed = parseCsv("code,value\n007,0.30\n");
    expect(parsed.rows[0]).toEqual({ code: "007", value: "0.30" });
  });

  it("handles quoted fields containing the delimiter", () => {
    const parsed = parseCsv('code,name\nA1,"Dal, cooked"\n');
    expect(parsed.rows[0]?.name).toBe("Dal, cooked");
  });

  it("handles escaped quotes and embedded newlines", () => {
    const parsed = parseCsv('code,name\nA1,"He said ""hi""\nand left"\n');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.name).toBe('He said "hi"\nand left');
  });

  it("handles CRLF without producing blank rows", () => {
    const parsed = parseCsv("code,name\r\nA1,Alpha\r\nA2,Beta\r\n");
    expect(parsed.rows).toHaveLength(2);
  });

  it("strips a UTF-8 BOM from the first column name", () => {
    // Otherwise every lookup against that column silently misses.
    const parsed = parseCsv("﻿code,name\nA1,Alpha\n");
    expect(parsed.headers[0]).toBe("code");
  });

  it("keeps the last row when the file has no trailing newline", () => {
    const parsed = parseCsv("code,name\nA1,Alpha");
    expect(parsed.rows).toHaveLength(1);
  });

  it("does not count a trailing newline as a row", () => {
    const parsed = parseCsv("code,name\nA1,Alpha\n\n");
    expect(parsed.rows).toHaveLength(1);
  });

  it("treats a short row's missing columns as empty, not undefined", () => {
    const parsed = parseCsv("code,name,note\nA1,Alpha\n");
    expect(parsed.rows[0]).toEqual({ code: "A1", name: "Alpha", note: "" });
  });

  it("supports an alternate delimiter", () => {
    const parsed = parseCsv("code;name\nA1;Alpha\n", ";");
    expect(parsed.rows[0]).toEqual({ code: "A1", name: "Alpha" });
  });
});

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

describe("manifest validation", () => {
  it("accepts a well-formed manifest and applies defaults", () => {
    const parsed = manifest();
    expect(parsed.basis.quantity).toBe(100);
    expect(parsed.basis.unit).toBe("g");
    expect(parsed.delimiter).toBe(",");
    expect(parsed.missingValues).toContain("NA");
  });

  it("rejects an unregistered source", () => {
    const result = parseDatasetManifest({
      source: "MADE_UP_TABLES",
      version: "1",
      file: "x.csv",
      identifierColumn: "code",
      nameColumn: "name",
      nutrients: [{ column: "energy", nutrient: "ENERGY", unit: "KCAL" }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/Unknown source code/);
  });

  it("rejects an unknown nutrient code", () => {
    const result = parseDatasetManifest({
      source: "IFCT",
      version: "1",
      file: "x.csv",
      identifierColumn: "code",
      nameColumn: "name",
      nutrients: [{ column: "x", nutrient: "UNOBTAINIUM", unit: "MG" }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/Unknown nutrient code/);
  });

  it("rejects a unit that disagrees with the dictionary", () => {
    // The mg/µg confusion is a factor of a thousand in a clinical figure, so
    // the import refuses rather than converting.
    const result = parseDatasetManifest({
      source: "IFCT",
      version: "1",
      file: "x.csv",
      identifierColumn: "code",
      nameColumn: "name",
      nutrients: [{ column: "iron", nutrient: "IRON", unit: "UG" }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/does not convert units/);
  });

  it("refuses a basis unit that cannot be resolved to a weight", () => {
    const result = parseDatasetManifest({
      source: "IFCT",
      version: "1",
      file: "x.csv",
      identifierColumn: "code",
      nameColumn: "name",
      basis: { quantity: 1, unit: "katori" },
      nutrients: [{ column: "energy", nutrient: "ENERGY", unit: "KCAL" }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toMatch(/canonical unit/);
  });

  it("refuses a manifest with no nutrient columns", () => {
    const result = parseDatasetManifest({
      source: "IFCT",
      version: "1",
      file: "x.csv",
      identifierColumn: "code",
      nameColumn: "name",
      nutrients: [],
    });
    expect(result.ok).toBe(false);
  });

  it.each([["../secrets.csv"], ["sub/dir.csv"], ["..\\windows.csv"], ["/etc/passwd"]])(
    "refuses a file path that could escape the data directory: %s",
    (file) => {
      const result = parseDatasetManifest({
        source: "IFCT",
        version: "1",
        file,
        identifierColumn: "code",
        nameColumn: "name",
        nutrients: [{ column: "energy", nutrient: "ENERGY", unit: "KCAL" }],
      });
      expect(result.ok).toBe(false);
    },
  );

  it("reports every problem at once rather than one per run", () => {
    const result = parseDatasetManifest({
      source: "NOPE",
      version: "",
      file: "x.csv",
      identifierColumn: "",
      nameColumn: "name",
      nutrients: [{ column: "x", nutrient: "NOPE", unit: "MG" }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(2);
  });
});

describe("dataset directory containment", () => {
  it("resolves a plain file name inside the data directory", () => {
    const resolved = resolveDatasetFile("fixture.csv", { NUTRITION_DATA_DIR: "/tmp/nut" });
    expect(resolved).toMatch(/fixture\.csv$/);
  });

  it("refuses to escape the data directory", () => {
    // Checked here as well as in the schema: a manifest is a file someone can
    // edit, and the importer must not be pointable at arbitrary paths.
    expect(() =>
      resolveDatasetFile("../../etc/passwd", { NUTRITION_DATA_DIR: "/tmp/nut" }),
    ).toThrow(/outside the nutrition data directory/);
  });
});

// ---------------------------------------------------------------------------
// Header validation
// ---------------------------------------------------------------------------

describe("header validation", () => {
  it("passes when every declared column is present", () => {
    const diagnostics = validateHeaders(
      ["code", "name", "energy", "protein", "iron"],
      manifest(),
    );
    expect(diagnostics).toEqual([]);
  });

  it("names each missing column once, before any row is read", () => {
    // A misspelled column would otherwise be reported as tens of thousands of
    // missing values — true, and useless.
    const diagnostics = validateHeaders(["code", "name", "energy"], manifest());
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.every((d) => d.code === "MISSING_COLUMN")).toBe(true);
    expect(diagnostics.map((d) => d.column).sort()).toEqual(["iron", "protein"]);
  });
});

// ---------------------------------------------------------------------------
// Normalization — the missing/zero rule
// ---------------------------------------------------------------------------

describe("missing is not zero", () => {
  it.each([[""], ["-"], ["NA"], ["N/A"], ["null"]])(
    "produces no nutrient value for a cell of %s",
    (cell) => {
      const { record, diagnostics } = normalizeRow(
        { code: "A1", name: "Test food", energy: "100", protein: cell, iron: "1" },
        manifest(),
        1,
      );

      const protein = record?.nutrients.find((n) => n.nutrientCode === "PROTEIN");
      // The whole point: absent, not 0.
      expect(protein).toBeUndefined();
      expect(record?.nutrients).toHaveLength(2);

      const missing = diagnostics.filter((d) => d.code === "MISSING_NUTRIENT_VALUE");
      expect(missing).toHaveLength(1);
      expect(missing[0]?.severity).toBe("warning");
    },
  );

  it("never emits a zero for a missing value", () => {
    const { record } = normalizeRow(
      { code: "A1", name: "Test food", energy: "", protein: "", iron: "" },
      manifest(),
      1,
    );

    expect(record).not.toBeNull();
    expect(record?.nutrients).toEqual([]);
    expect(JSON.stringify(record?.nutrients)).not.toContain("0");
  });

  it("keeps a published zero, which is a measurement", () => {
    // "The source measured it and found none" is a different fact from "the
    // source did not measure it", and both must survive the import.
    const { record } = normalizeRow(
      { code: "A1", name: "Test food", energy: "0", protein: "0.0", iron: "" },
      manifest(),
      1,
    );

    expect(record?.nutrients).toHaveLength(2);
    expect(record?.nutrients[0]?.value).toBe("0");
    expect(record?.nutrients[1]?.value).toBe("0.0");
  });

  it("warns when a record yields no values at all", () => {
    const { diagnostics } = normalizeRow(
      { code: "A1", name: "Test food", energy: "", protein: "", iron: "" },
      manifest(),
      1,
    );
    expect(diagnostics.some((d) => d.code === "NO_NUTRIENT_VALUES")).toBe(true);
  });
});

describe("numeric validation", () => {
  it("carries values as strings so no float ever touches them", () => {
    const { record } = normalizeRow(
      { code: "A1", name: "Test food", energy: "11111.10", protein: "3.30", iron: "0.70" },
      manifest(),
      1,
    );

    // "3.30" survives verbatim. Through a JavaScript number it would become
    // "3.3", and 0.7 cannot be represented exactly at all.
    expect(record?.nutrients.map((n) => n.value)).toEqual(["11111.10", "3.30", "0.70"]);
    for (const nutrient of record?.nutrients ?? []) {
      expect(typeof nutrient.value).toBe("string");
    }
  });

  it.each([["abc"], ["12abc"], ["1,234"], ["~5"], ["<0.1"]])(
    "rejects %s rather than guessing at it",
    (cell) => {
      const { diagnostics } = normalizeRow(
        { code: "A1", name: "Test food", energy: cell, protein: "1", iron: "1" },
        manifest(),
        1,
      );

      const invalid = diagnostics.filter((d) => d.code === "INVALID_NUMBER");
      expect(invalid).toHaveLength(1);
      expect(invalid[0]?.severity).toBe("error");
    },
  );

  it("rejects a thousands separator instead of picking a convention", () => {
    // "1,234" is 1234 in one convention and 1.234 in another. Guessing would
    // corrupt the value by a factor of a thousand.
    const { record } = normalizeRow(
      { code: "A1", name: "Test food", energy: "1,234", protein: "1", iron: "1" },
      manifest(),
      1,
    );
    expect(record?.nutrients.some((n) => n.nutrientCode === "ENERGY")).toBe(false);
  });

  it("rejects a negative quantity", () => {
    const { diagnostics } = normalizeRow(
      { code: "A1", name: "Test food", energy: "-5", protein: "1", iron: "1" },
      manifest(),
      1,
    );
    expect(diagnostics.some((d) => d.code === "NEGATIVE_VALUE")).toBe(true);
  });

  it.each([["NaN"], ["Infinity"], ["-Infinity"], ["1e"], ["."]])(
    "rejects the non-finite literal %s",
    (cell) => {
      const { record } = normalizeRow(
        { code: "A1", name: "Test food", energy: cell, protein: "1", iron: "1" },
        manifest(),
        1,
      );
      expect(record?.nutrients.some((n) => n.nutrientCode === "ENERGY")).toBe(false);
    },
  );

  it("rejects a value too large for the column", () => {
    const { diagnostics } = normalizeRow(
      { code: "A1", name: "Test food", energy: "123456789", protein: "1", iron: "1" },
      manifest(),
      1,
    );
    expect(diagnostics.some((d) => d.code === "VALUE_OUT_OF_RANGE")).toBe(true);
  });

  it("warns rather than silently rounding excess precision", () => {
    const { record, diagnostics } = normalizeRow(
      { code: "A1", name: "Test food", energy: "1.1234567", protein: "1", iron: "1" },
      manifest(),
      1,
    );

    expect(diagnostics.some((d) => d.code === "PRECISION_LOSS")).toBe(true);
    // Still imported — the rounding is documented, not avoided.
    expect(record?.nutrients.some((n) => n.nutrientCode === "ENERGY")).toBe(true);
  });

  it("does not count leading zeros against the column's capacity", () => {
    const { diagnostics } = normalizeRow(
      { code: "A1", name: "Test food", energy: "000000123", protein: "1", iron: "1" },
      manifest(),
      1,
    );
    expect(diagnostics.some((d) => d.code === "VALUE_OUT_OF_RANGE")).toBe(false);
  });
});

describe("record structure", () => {
  it("rejects a row with no identifier", () => {
    const { record, diagnostics } = normalizeRow(
      { code: "", name: "Test food", energy: "1", protein: "1", iron: "1" },
      manifest(),
      1,
    );
    expect(record).toBeNull();
    expect(diagnostics.some((d) => d.code === "MISSING_IDENTIFIER")).toBe(true);
  });

  it("rejects a row with no name", () => {
    const { record, diagnostics } = normalizeRow(
      { code: "A1", name: "   ", energy: "1", protein: "1", iron: "1" },
      manifest(),
      1,
    );
    expect(record).toBeNull();
    expect(diagnostics.some((d) => d.code === "MISSING_NAME")).toBe(true);
  });

  it("keeps both the published identity and Vyom's own", () => {
    const { record } = normalizeRow(
      { code: "A1", name: "Toor dal, raw", energy: "1", protein: "1", iron: "1" },
      manifest(),
      1,
    );

    expect(record?.externalId).toBe("A1");
    expect(record?.externalName).toBe("Toor dal, raw");
    // Curation is a human task; the importer does not rename anything.
    expect(record?.canonicalName).toBe("Toor dal, raw");
    expect(record?.raw).toBeDefined();
  });

  it("records the basis on every value", () => {
    const { record } = normalizeRow(
      { code: "A1", name: "Test food", energy: "1", protein: "1", iron: "1" },
      manifest(),
      1,
    );

    for (const nutrient of record?.nutrients ?? []) {
      expect(nutrient.basisQuantity).toBe("100");
      expect(nutrient.basisUnitCode).toBe("g");
    }
  });

  it("carries a non-default basis through unchanged", () => {
    const { record } = normalizeRow(
      { code: "A1", name: "Test food", energy: "1", protein: "1", iron: "1" },
      manifest({ basis: { quantity: 30, unit: "ml" } }),
      1,
    );

    expect(record?.nutrients[0]?.basisQuantity).toBe("30");
    expect(record?.nutrients[0]?.basisUnitCode).toBe("ml");
  });
});

describe("category and type mapping", () => {
  const withCategory = () =>
    manifest({
      categoryColumn: "group",
      categoryMap: { Pulses: "PULSES" },
      defaultCategory: "OTHER",
    });

  it("maps a published category through the manifest", () => {
    const { record } = normalizeRow(
      { code: "A1", name: "Test", group: "Pulses", energy: "1", protein: "1", iron: "1" },
      withCategory(),
      1,
    );
    expect(record?.category).toBe("PULSES");
    expect(record?.externalCategory).toBe("Pulses");
  });

  it("falls back and warns for an unmapped category, keeping the original wording", () => {
    const { record, diagnostics } = normalizeRow(
      { code: "A1", name: "Test", group: "Millets", energy: "1", protein: "1", iron: "1" },
      withCategory(),
      1,
    );

    expect(record?.category).toBe("OTHER");
    // The publisher's wording survives so the mapping can be completed later.
    expect(record?.externalCategory).toBe("Millets");
    expect(diagnostics.some((d) => d.code === "UNMAPPED_CATEGORY")).toBe(true);
  });

  it("applies the manifest's default food type", () => {
    const { record } = normalizeRow(
      { code: "A1", name: "Test", energy: "1", protein: "1", iron: "1" },
      manifest({ foodType: "COOKED" }),
      1,
    );
    expect(record?.foodType).toBe("COOKED");
  });
});

describe("aliases", () => {
  const withAliases = () =>
    manifest({ aliasColumns: [{ column: "other_names", separator: ";" }] });

  it("splits a multi-name cell", () => {
    const { record } = normalizeRow(
      {
        code: "A1",
        name: "Toor Dal",
        other_names: "Tur Dal; Arhar Dal ;Pigeon Pea",
        energy: "1",
        protein: "1",
        iron: "1",
      },
      withAliases(),
      1,
    );

    expect(record?.aliases.map((a) => a.alias)).toEqual([
      "Tur Dal",
      "Arhar Dal",
      "Pigeon Pea",
    ]);
  });

  it("drops an alias identical to the canonical name", () => {
    const { record } = normalizeRow(
      {
        code: "A1",
        name: "Toor Dal",
        other_names: "toor dal;Tur Dal",
        energy: "1",
        protein: "1",
        iron: "1",
      },
      withAliases(),
      1,
    );
    expect(record?.aliases.map((a) => a.alias)).toEqual(["Tur Dal"]);
  });

  it("does not repeat a duplicated alias", () => {
    const { record } = normalizeRow(
      {
        code: "A1",
        name: "Toor Dal",
        other_names: "Tur Dal;Tur Dal",
        energy: "1",
        protein: "1",
        iron: "1",
      },
      withAliases(),
      1,
    );
    expect(record?.aliases).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

describe("import report", () => {
  it("shows counted figures and labels missing values as absent", () => {
    const statistics = { ...emptyStatistics(), recordsRead: 3, nutrientValuesMissing: 4 };

    const text = formatImportReport({
      sourceCode: "IFCT",
      sourceName: "Indian Food Composition Tables",
      version: "test-fixture",
      fileName: "fixture.csv",
      checksum: "abc123",
      dryRun: false,
      statistics,
      diagnostics: [],
      startedAt: new Date("2026-08-18T10:00:00Z"),
      completedAt: new Date("2026-08-18T10:00:01Z"),
    });

    expect(text).toMatch(/Records\n\s+Read\s+3/);
    expect(text).toMatch(/Missing\s+4\s+\(source published no value — stored as absent, not zero\)/);
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("undefined");
  });

  it("says plainly when a run wrote nothing", () => {
    const text = formatImportReport({
      sourceCode: "IFCT",
      sourceName: "Indian Food Composition Tables",
      version: "test-fixture",
      fileName: "fixture.csv",
      checksum: null,
      dryRun: true,
      statistics: emptyStatistics(),
      diagnostics: [],
      startedAt: new Date(),
      completedAt: new Date(),
    });
    expect(text).toContain("DRY RUN");
  });

  it("summarises repeated diagnostics instead of printing thousands", () => {
    const diagnostics = Array.from({ length: 50 }, (_, index) => ({
      severity: "error" as const,
      code: "INVALID_NUMBER" as const,
      row: index + 1,
      message: "not a number",
    }));

    const text = formatImportReport({
      sourceCode: "IFCT",
      sourceName: "Indian Food Composition Tables",
      version: "test-fixture",
      fileName: "fixture.csv",
      checksum: null,
      dryRun: false,
      statistics: emptyStatistics(),
      diagnostics,
      startedAt: new Date(),
      completedAt: new Date(),
    });

    // The count stays exact; only the examples are truncated.
    expect(text).toContain("INVALID_NUMBER  ×50");
    expect(text).toContain("and 45 more");
  });
});
