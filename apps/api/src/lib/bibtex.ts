/**
 * A small, strict BibTeX reader (the citation format Google Scholar, Zotero,
 * Mendeley, Scopus etc. export), written for this app instead of pulling in a
 * parser library.
 *
 * SECURITY: an uploaded file is untrusted input.
 *  - It is only ever READ as text: nothing in it is executed or evaluated, and
 *    LaTeX commands are not interpreted, only a fixed list is turned into
 *    letters (e.g. {\"o} -> ö) and everything else is dropped.
 *  - Hard limits on file size, number of entries, field length and brace
 *    nesting stop a crafted file from using up memory or CPU (denial of service).
 *  - The parser never throws on bad input: problems are reported per entry
 *    with a line number, and the rest of the file is still read.
 *  - The resulting values are validated again (same rules as manual entry)
 *    before anything is saved, and React escapes them when they are shown.
 */

export const BIBTEX_LIMITS = {
  /** Largest file accepted (a 500-paper Scholar export is ~200 KB). */
  maxBytes: 1_000_000,
  maxEntries: 1000,
  maxFieldLength: 10_000,
  maxBraceDepth: 20,
} as const;

export interface BibEntry {
  /** 1-based line where the entry starts, for error messages. */
  line: number;
  type: string;
  key: string;
  /** Field name (lower case) -> raw value, LaTeX not yet cleaned. */
  fields: Record<string, string>;
}

export interface BibProblem {
  line: number;
  message: string;
}

export interface BibParseResult {
  entries: BibEntry[];
  errors: BibProblem[];
}

const MONTHS: Record<string, string> = {
  jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June',
  jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December',
};

const BOM = String.fromCharCode(0xfeff);

class BibSyntaxError extends Error {
  constructor(
    message: string,
    public readonly at: number,
    /** True when the rest of the file cannot be read reliably (e.g. unclosed brace). */
    public readonly fatal = false,
  ) {
    super(message);
  }
}

export function parseBibtex(input: string): BibParseResult {
  const text = input.startsWith(BOM) ? input.slice(1) : input; // ignore a byte-order mark
  const entries: BibEntry[] = [];
  const errors: BibProblem[] = [];

  // Line numbers: offsets of every newline, searched with a binary search.
  const newlines: number[] = [];
  for (let k = text.indexOf('\n'); k !== -1; k = text.indexOf('\n', k + 1)) newlines.push(k);
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((newlines[mid] as number) < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };

  if (text.length > BIBTEX_LIMITS.maxBytes) {
    return { entries, errors: [{ line: 1, message: `The file is too large (limit ${BIBTEX_LIMITS.maxBytes / 1_000_000} MB)` }] };
  }

  let i = 0;
  const skipSpace = () => {
    while (i < text.length && /\s/.test(text[i] as string)) i++;
  };

  /** Read a {...} group starting at text[i] === '{'; returns the inside. */
  const readBraced = (): string => {
    const start = i;
    let depth = 0;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\\') {
        i++; // an escaped character (e.g. \{ or \}) never changes the depth
        continue;
      }
      if (ch === '{') {
        depth++;
        if (depth > BIBTEX_LIMITS.maxBraceDepth) throw new BibSyntaxError('Braces are nested too deeply', start, true);
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          i++;
          return text.slice(start + 1, i - 1);
        }
      }
    }
    throw new BibSyntaxError('A "{" is never closed', start, true);
  };

  /** Read a "..." value; braces inside may contain quotes. */
  const readQuoted = (): string => {
    const start = i;
    i++; // opening quote
    let depth = 0;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '"' && depth === 0) {
        i++;
        return text.slice(start + 1, i - 1);
      }
      if (depth > BIBTEX_LIMITS.maxBraceDepth) throw new BibSyntaxError('Braces are nested too deeply', start, true);
    }
    throw new BibSyntaxError('A quoted value is never closed', start, true);
  };

  /** value = part ( "#" part )*, where part is {...}, "..." or a number / name. */
  const readValue = (): string => {
    const parts: string[] = [];
    for (;;) {
      skipSpace();
      const ch = text[i];
      if (ch === '{') parts.push(readBraced());
      else if (ch === '"') parts.push(readQuoted());
      else {
        const m = /^[A-Za-z0-9_\-:.+/]+/.exec(text.slice(i, i + 200));
        if (!m) throw new BibSyntaxError('Expected a value after "="', i);
        i += m[0].length;
        // Bare names are @string macros; only the month abbreviations are known.
        parts.push(MONTHS[m[0].toLowerCase()] ?? m[0]);
      }
      skipSpace();
      if (text[i] !== '#') break;
      i++;
    }
    const value = parts.join('');
    if (value.length > BIBTEX_LIMITS.maxFieldLength) throw new BibSyntaxError('A field value is too long', i);
    return value;
  };

  /** Skip to the end of the current entry after an error, if the braces allow it. */
  const skipEntry = (entryStart: number) => {
    i = entryStart;
    try {
      while (i < text.length && text[i] !== '{' && text[i] !== '(') i++;
      if (text[i] === '{') readBraced();
      else i = text.indexOf('@', i + 1) === -1 ? text.length : text.indexOf('@', i + 1);
    } catch {
      i = text.length;
    }
  };

  while (i < text.length) {
    const at = text.indexOf('@', i);
    if (at === -1) break; // text outside entries is a comment in BibTeX
    i = at + 1;
    // An "@" glued to other text (e.g. an e-mail address in a comment) is not an entry.
    if (at > 0 && !/\s/.test(text[at - 1] as string)) continue;
    const typeMatch = /^[A-Za-z]+/.exec(text.slice(i, i + 40));
    if (!typeMatch) continue; // a stray "@"
    const type = typeMatch[0].toLowerCase();
    i += typeMatch[0].length;
    skipSpace();
    const open = text[i];
    if (open !== '{' && open !== '(') {
      errors.push({ line: lineAt(at), message: `Expected "{" after @${type}` });
      continue;
    }

    try {
      if (type === 'comment' || type === 'preamble' || type === 'string') {
        // Not publications. (@string macros are not expanded; unknown names are kept as text.)
        if (open === '{') readBraced();
        else i = text.indexOf(')', i) === -1 ? text.length : text.indexOf(')', i) + 1;
        continue;
      }
      const close = open === '{' ? '}' : ')';
      i++;
      skipSpace();
      const keyMatch = /^[^,\s}){]*/.exec(text.slice(i, i + 300)) as RegExpExecArray;
      const key = keyMatch[0];
      i += key.length;
      skipSpace();
      const fieldMap = new Map<string, string>();
      if (text[i] === ',') {
        i++;
        for (;;) {
          skipSpace();
          if (text[i] === close) {
            i++;
            break;
          }
          if (i >= text.length) throw new BibSyntaxError(`The entry "${key}" is never closed`, at, true);
          const name = /^[A-Za-z][A-Za-z0-9_\-:.]*/.exec(text.slice(i, i + 100));
          if (!name) throw new BibSyntaxError(`Unexpected character "${text[i]}" in entry "${key}"`, i);
          i += name[0].length;
          skipSpace();
          if (text[i] !== '=') throw new BibSyntaxError(`Expected "=" after "${name[0]}"`, i);
          i++;
          const fieldName = name[0].toLowerCase();
          const fieldValue = readValue();
          if (fieldName !== '__proto__' && fieldName !== 'constructor' && fieldName !== 'prototype') {
            fieldMap.set(fieldName, fieldValue);
          }
          skipSpace();
          if (i >= text.length) throw new BibSyntaxError(`The entry "${key}" is never closed`, at, true);
          if (text[i] === ',') i++;
          else if (text[i] === close) {
            i++;
            break;
          } else throw new BibSyntaxError(`Expected "," or "${close}" after the "${name[0]}" field`, i);
        }
      } else if (text[i] === close) {
        i++;
      } else {
        throw new BibSyntaxError(`Expected "," after the entry key "${key}"`, i);
      }

      if (entries.length >= BIBTEX_LIMITS.maxEntries) {
        errors.push({ line: lineAt(at), message: `Only the first ${BIBTEX_LIMITS.maxEntries} entries are read` });
        break;
      }
      entries.push({ line: lineAt(at), type, key, fields: Object.fromEntries(fieldMap) });
    } catch (err) {
      if (!(err instanceof BibSyntaxError)) throw err;
      errors.push({ line: lineAt(err.at), message: err.message });
      if (err.fatal) break;
      skipEntry(at);
    }
  }
  return { entries, errors };
}

// ------------------------------------------------------------ LaTeX -> text

const COMBINING: Record<string, number> = {
  "'": 0x301, '`': 0x300, '^': 0x302, '"': 0x308, '~': 0x303, '=': 0x304, '.': 0x307,
  c: 0x327, v: 0x30c, u: 0x306, H: 0x30b, k: 0x328, r: 0x30a,
};

const SYMBOLS: Record<string, string> = {
  ss: 'ß', o: 'ø', O: 'Ø', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', l: 'ł', L: 'Ł',
  i: 'ı', j: 'ȷ', textendash: String.fromCharCode(0x2013), textemdash: String.fromCharCode(0x2014),
};

const ESCAPABLE = '&%$#_{}';
const PRIVATE_USE = 0xe000;

/**
 * Turn BibTeX/LaTeX markup into plain text: accents to letters, a few
 * symbols, formatting commands to their content; everything else is dropped.
 */
export function latexToText(value: string): string {
  let s = value;
  // Accents: \'e, \'{e}, {\'e}, \c{c}, \"{\i}
  s = s.replace(/\\(['`^"~=.]|[cvuHkr](?=[\s{]))\s*\{?\s*(\\[ij]|[A-Za-z])\s*\}?/g, (_m, accent: string, letter: string) => {
    const base = letter === '\\i' ? 'i' : letter === '\\j' ? 'j' : letter;
    const mark = COMBINING[accent];
    return mark ? (base + String.fromCharCode(mark)).normalize('NFC') : base;
  });
  // Escaped special characters (\& \% \$ \# \_ \{ \}) are set aside as
  // private-use characters, so the clean-up below cannot strip an escaped $
  // or brace, and are restored at the end.
  s = s.replace(/\\([&%$#_{}])/g, (_m, ch: string) => String.fromCharCode(PRIVATE_USE + ESCAPABLE.indexOf(ch)));
  // Named symbols such as \ss or {\o}.
  s = s.replace(/\\([A-Za-z]+)\b\s*(\{\})?/g, (m, name: string) => SYMBOLS[name] ?? m);
  // Formatting commands keep their content: \textit{x}, \emph{x}, \mathrm{x}...
  for (let n = 0; n < 10 && /\\[A-Za-z]+\s*\{[^{}]*\}/.test(s); n++) s = s.replace(/\\[A-Za-z]+\s*\{([^{}]*)\}/g, '$1');
  s = s
    .replace(/\\[A-Za-z]+\*?/g, '') // any other command: dropped
    .replace(/\\./g, '') // stray escapes
    .replace(/---/g, String.fromCharCode(0x2014))
    .replace(/--/g, String.fromCharCode(0x2013))
    .replace(/~/g, ' ')
    .replace(/[{}$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...s]
    .map((ch) => {
      const k = ch.charCodeAt(0) - PRIVATE_USE;
      return k >= 0 && k < ESCAPABLE.length ? ESCAPABLE[k] : ch;
    })
    .join('');
}

/**
 * Split an author list on " and " (outside braces, so "{Barnes and Noble}"
 * stays one name) and turn "Last, First" into "First Last".
 */
export function splitAuthors(raw: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let start = 0;
  for (let k = 0; k < raw.length; k++) {
    const ch = raw[k];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (depth === 0 && /\s/.test(ch as string)) {
      const m = /^\s+and\s+/i.exec(raw.slice(k, k + 10));
      if (m) {
        names.push(raw.slice(start, k));
        k += m[0].length - 1;
        start = k + 1;
      }
    }
  }
  names.push(raw.slice(start));
  return names
    .map((n) => n.trim())
    .filter((n) => n && n.toLowerCase() !== 'others')
    .map((n) => {
      const parts = splitTopLevel(n, ',').map((p) => latexToText(p));
      // "Last, First" or "Last, Jr., First"
      if (parts.length === 2) return `${parts[1]} ${parts[0]}`.trim();
      if (parts.length >= 3) return `${parts[2]} ${parts[0]} ${parts[1]}`.trim();
      return latexToText(n);
    })
    .filter(Boolean);
}

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '{') depth++;
    else if (s[k] === '}') depth--;
    else if (s[k] === sep && depth === 0) {
      out.push(s.slice(start, k));
      start = k + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}
