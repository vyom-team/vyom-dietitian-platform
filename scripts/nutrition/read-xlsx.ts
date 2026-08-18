import ExcelJS from "exceljs";

import type { ParsedFile, RawRow } from "../../src/lib/nutrition/ingest/types.js";

/**
 * Reads a spreadsheet into the same shape the CSV parser produces.
 *
 * Lives in `scripts/` rather than `src/` on purpose. Reading files is an
 * ingestion concern, never an application one, and keeping the dependency here
 * means `exceljs` can never be pulled into a browser bundle. Adapters stay pure
 * — rows in, records out — and are testable without a spreadsheet.
 *
 * EVERY CELL COMES OUT AS A STRING.
 *
 * A spreadsheet reader that helpfully hands back numbers would defeat the
 * precision rules the rest of the pipeline is built on: a food code of "007"
 * would become 7, and a published "0.30" would become 0.3 before validation
 * ever saw it. Values are rendered back to text exactly as stored, and parsing
 * them is the normalizer's job.
 */
export async function readXlsx(path: string, sheetName?: string): Promise<ParsedFile> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);

  const sheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];

  if (!sheet) {
    throw new Error(
      sheetName
        ? `The workbook has no sheet named "${sheetName}".`
        : "The workbook contains no sheets.",
    );
  }

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, column) => {
    headers[column - 1] = cellToString(cell.value).trim();
  });

  const rows: RawRow[] = [];

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const record: Record<string, string> = {};
    let hasValue = false;

    for (let column = 0; column < headers.length; column += 1) {
      const key = headers[column];
      if (!key) continue;

      const value = cellToString(row.getCell(column + 1).value);
      record[key] = value;
      if (value !== "") hasValue = true;
    }

    // A spreadsheet's used range often extends past the real data. A row of
    // entirely empty cells is formatting, not a record, and counting it would
    // inflate every "records read" figure.
    if (hasValue) rows.push(record);
  });

  return { headers: headers.filter((header) => header !== ""), rows };
}

/**
 * Renders a cell to text without interpreting it.
 *
 * Numbers go through `String()` rather than any formatting, so the value stored
 * in the file is what reaches the pipeline.
 */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";

  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    // A formula cell carries its computed result; that is the published value.
    if ("result" in value && value.result !== undefined) {
      return cellToString(value.result as ExcelJS.CellValue);
    }
    // Rich text: concatenate the runs, discarding only the formatting.
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((run) => run.text).join("");
    }
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("error" in value) return "";
  }

  return String(value);
}
