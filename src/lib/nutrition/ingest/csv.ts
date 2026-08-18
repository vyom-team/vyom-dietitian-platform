import type { ParsedFile, RawRow } from "./types";

/**
 * A CSV reader for dataset ingestion.
 *
 * WHY NOT A LIBRARY
 *
 * The project rule is to keep dependencies minimal, and this is a genuinely
 * small problem: RFC 4180 quoting, a configurable delimiter, and both line
 * ending conventions. Roughly seventy lines, fully under test, with no
 * transitive supply chain — against a dependency that would sit in the build
 * of a healthcare product. The trade is worth making here and would not be for
 * anything larger.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * No type inference. Every cell comes out as a string, exactly as written.
 * A CSV reader that helpfully turns "0.30" into the number 0.3, or a food code
 * like "007" into 7, would corrupt data before validation ever saw it. Parsing
 * numbers is the normalizer's job, and it does so into decimal strings.
 */

/** Rows are returned in file order; the first non-empty line is the header. */
export function parseCsv(text: string, delimiter = ","): ParsedFile {
  // A UTF-8 BOM would otherwise become part of the first column's name, and
  // every lookup against that column would silently miss.
  const content = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const records = splitRecords(content, delimiter);
  if (records.length === 0) return { headers: [], rows: [] };

  const headerRecord = records[0];
  if (!headerRecord) return { headers: [], rows: [] };

  const headers = headerRecord.map((header) => header.trim());
  const rows: RawRow[] = [];

  for (let index = 1; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;

    // A trailing newline produces a final record of one empty field. That is
    // file formatting, not a data row, and counting it would inflate every
    // "records read" figure by one.
    if (record.length === 1 && record[0]?.trim() === "") continue;

    const row: Record<string, string> = {};
    for (let column = 0; column < headers.length; column += 1) {
      const key = headers[column];
      if (key === undefined) continue;
      // Short rows yield empty cells rather than `undefined`, so a missing
      // trailing column behaves exactly like a blank one and is reported as
      // missing rather than crashing the run.
      row[key] = record[column] ?? "";
    }
    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Splits CSV text into records of fields.
 *
 * A character-by-character scan rather than a split on newlines: a quoted field
 * may legitimately contain the delimiter, a newline, or an escaped quote, and
 * splitting first would tear those rows apart.
 */
function splitRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === delimiter) {
      fields.push(field);
      field = "";
      continue;
    }

    if (char === "\n" || char === "\r") {
      // Consume CRLF as one terminator so a Windows-authored file does not
      // produce an empty record between every row.
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      fields.push(field);
      records.push(fields);
      fields = [];
      field = "";
      continue;
    }

    field += char;
  }

  // Whatever is buffered when the text ends is the last record — a file with no
  // trailing newline must not lose its final row.
  if (field.length > 0 || fields.length > 0) {
    fields.push(field);
    records.push(fields);
  }

  return records;
}
