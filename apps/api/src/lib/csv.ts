/**
 * Minimal, dependency-free CSV writer.
 *
 * SECURITY (CSV / formula injection): spreadsheet programs treat a cell that
 * starts with = + - @ (or a tab / carriage return) as a formula. A malicious
 * publication title such as `=HYPERLINK("http://evil.example","click")` could
 * run when an admin opens the export in Excel. We put a single quote in front
 * of such values so they are shown as plain text (OWASP CSV Injection advice).
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const UTF8_BOM = String.fromCharCode(0xfeff);

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  // Quote every cell and double any quotes inside it (RFC 4180).
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));
  // Windows line endings + a UTF-8 byte-order mark so Excel shows accents correctly.
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}
