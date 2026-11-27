import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BIBTEX_LIMITS, latexToText, parseBibtex, splitAuthors, type BibEntry } from '../../src/lib/bibtex.js';
import { mapBibType, toCandidate } from '../../src/services/bibtex-import.js';

const sample = readFileSync(new URL('../fixtures/scholar-export.bib', import.meta.url), 'utf8');
const entry = (type: string, fields: Record<string, string>): BibEntry => ({ line: 1, type, key: 'k', fields });

describe('parseBibtex', () => {
  it('reads a Google Scholar export', () => {
    const { entries, errors } = parseBibtex(sample);
    expect(errors).toEqual([]);
    expect(entries.map((e) => [e.line, e.type, e.key])).toEqual([
      [4, 'article', 'rastogi2023solar'],
      [15, 'inproceedings', 'rastogi2022iot'],
      [24, 'phdthesis', 'rastogi2021thesis'],
      [31, 'article', 'rastogi2024llm'],
      [38, 'book', 'rastogi2020book'],
      [45, 'incollection', 'rastogi2019chapter'],
      [54, 'article', 'rastogi2018nodate'],
      [60, 'article', 'rastogi2023solar_copy'],
      [69, 'misc', 'rastogi2017talk'],
    ]);
    expect(entries[0]?.fields).toMatchObject({ title: 'Solar-assisted drying of agricultural produce: a review', pages: '45--67', year: '2023' });
  });

  it('handles quotes, # concatenation, month macros, bare numbers and (...) entries', () => {
    const talk = parseBibtex(sample).entries.at(-1);
    expect(talk?.fields).toMatchObject({ title: 'Keynote: Clean cooking fuels', month: 'January', year: '2017' });
  });

  it('keeps braces inside values and quotes inside braces', () => {
    const { entries } = parseBibtex('@article{a, title = "A {"quoted"} {B}ig title", note = {x {y {z}} w}}');
    expect(entries[0]?.fields).toEqual({ title: 'A {"quoted"} {B}ig title', note: 'x {y {z}} w' });
  });

  it('skips comments, @string, @preamble and text outside entries', () => {
    const { entries, errors } = parseBibtex(
      'Contact me@example.org\n@string{ieee = "IEEE"}\n@preamble{"\\newcommand"}\n@comment{ignored @article{x}}\n@misc{only, year = 2020}',
    );
    expect(errors).toEqual([]);
    expect(entries.map((e) => e.key)).toEqual(['only']);
  });

  it('accepts an entry with no fields and a trailing comma', () => {
    expect(parseBibtex('@misc{bare}\n@misc{trail, year = 2020,}').entries.map((e) => e.key)).toEqual(['bare', 'trail']);
  });

  it('reports a broken entry with its line number and keeps reading the next ones', () => {
    const { entries, errors } = parseBibtex('@article{good1, year = 2020}\n@article{bad, title = }\n@article{bad2 year}\n@article{good2, year = 2021}');
    expect(entries.map((e) => e.key)).toEqual(['good1', 'good2']);
    expect(errors).toEqual([
      { line: 2, message: 'Expected a value after "="' },
      { line: 3, message: 'Expected "," after the entry key "bad2"' },
    ]);
  });

  it.each([
    ['@article{a, title = {never closed', 'A "{" is never closed'],
    ['@article{a, title = "never closed}', 'A quoted value is never closed'],
    ['@article{a, title = {x}', 'The entry "a" is never closed'],
    ['@article{a, title = {x} junk}', 'Expected "," or "}" after the "title" field'],
    ['@article{a, 9title = {x}}', 'Unexpected character "9" in entry "a"'],
    ['@article{a, title {x}}', 'Expected "=" after "title"'],
    ['@article a', 'Expected "{" after @article'],
  ])('reports malformed input: %s', (input, message) => {
    expect(parseBibtex(input).errors[0]?.message).toBe(message);
  });

  it('stops at a file that is too large, too deeply nested or has too many entries (DoS limits)', () => {
    expect(parseBibtex('x'.repeat(BIBTEX_LIMITS.maxBytes + 1)).errors[0]?.message).toMatch(/too large/);
    const deep = `@article{a, title = ${'{'.repeat(25)}x${'}'.repeat(25)}}`;
    expect(parseBibtex(deep).errors[0]?.message).toBe('Braces are nested too deeply');
    const many = parseBibtex('@misc{a, year = 2020}\n'.repeat(BIBTEX_LIMITS.maxEntries + 5));
    expect(many.entries).toHaveLength(BIBTEX_LIMITS.maxEntries);
    expect(many.errors[0]?.message).toMatch(/Only the first 1000 entries/);
    const long = parseBibtex(`@misc{a, note = {${'x'.repeat(BIBTEX_LIMITS.maxFieldLength + 1)}}, year = 2020}`);
    expect(long.errors[0]?.message).toBe('A field value is too long');
  });

  it('ignores a byte-order mark', () => {
    expect(parseBibtex(`${String.fromCharCode(0xfeff)}@misc{a, year = 2020}`).entries).toHaveLength(1);
  });
});

describe('latexToText', () => {
  it.each([
    ['M{\\"u}ller', 'Müller'],
    ["Jos{\\'e} Garc\\'{\\i}a", 'José García'],
    ['\\c{C}a\\u{g}lar \\v{S}imon', 'Çağlar Šimon'],
    ['Stra{\\ss}e and {\\o}re', 'Straße and øre'],
    ['R\\&D, 50\\% \\$ \\#1 a\\_b', 'R&D, 50% $ #1 a_b'],
    ['\\textit{In vivo} \\emph{study} of \\textbf{\\textsc{CO}}$_2$', 'In vivo study of CO_2'],
    ['pages 1--2 --- done~now', 'pages 1\u20132 \u2014 done now'],
    ['{{Deep}}   {Learning}\n', 'Deep Learning'],
    ['\\unknowncommand text \\\\ end', 'text end'],
  ])('%s -> %s', (input, expected) => {
    expect(latexToText(input)).toBe(expected);
  });

  it('never runs or keeps markup that could be code; React shows it as text', () => {
    expect(latexToText('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
  });
});

describe('splitAuthors', () => {
  it.each([
    ['Rastogi, Srashti and Sharma, Abhinav', ['Srashti Rastogi', 'Abhinav Sharma']],
    ['Srashti Rastogi AND Abhinav Sharma and others', ['Srashti Rastogi', 'Abhinav Sharma']],
    ['{Barnes and Noble} and Doe, Jane', ['Barnes and Noble', 'Jane Doe']],
    ['King, Jr., Martin Luther', ['Martin Luther King Jr.']],
    ['M{\\"u}ller, J{\\"o}rg', ['Jörg Müller']],
    ['', []],
  ])('%s', (input, expected) => {
    expect(splitAuthors(input)).toEqual(expected);
  });
});

describe('mapping entries to publications', () => {
  it.each([
    ['article', {}, 'JOURNAL_ARTICLE'],
    ['article', { journal: 'arXiv preprint arXiv:1234' }, 'PREPRINT'],
    ['inproceedings', {}, 'CONFERENCE_PAPER'],
    ['conference', {}, 'CONFERENCE_PAPER'],
    ['book', {}, 'BOOK'],
    ['proceedings', {}, 'BOOK'],
    ['incollection', {}, 'BOOK_CHAPTER'],
    ['inbook', {}, 'BOOK_CHAPTER'],
    ['phdthesis', {}, 'THESIS'],
    ['mastersthesis', {}, 'THESIS'],
    ['unpublished', {}, 'PREPRINT'],
    ['misc', { eprint: '2401.01234' }, 'PREPRINT'],
    ['misc', { howpublished: 'medRxiv' }, 'PREPRINT'],
    ['techreport', {}, 'OTHER'],
  ] as const)('@%s %o -> %s', (type, fields, expected) => {
    expect(mapBibType(entry(type, fields))).toBe(expected);
  });

  it('builds a clean candidate from a Scholar entry', () => {
    const c = toCandidate(parseBibtex(sample).entries[3] as BibEntry, 3);
    expect(c).toMatchObject({
      title: 'Large language models for crop advisories',
      authors: ['Srashti Rastogi', 'Jörg Müller', 'José García'],
      venue: 'arXiv preprint arXiv:2401.01234',
      year: 2024,
      type: 'PREPRINT',
      status: 'new',
    });
  });

  it('finds DOIs in the doi, url or note fields', () => {
    expect(toCandidate(entry('article', { title: 'T', author: 'A B', year: '2020', doi: 'https://doi.org/10.5555/ABC' }), 0).doi).toBe('10.5555/abc');
    expect(toCandidate(entry('article', { title: 'T', author: 'A B', year: '2020', url: 'https://doi.org/10.5555/xyz.' }), 0).doi).toBe('10.5555/xyz');
    expect(toCandidate(entry('article', { title: 'T', author: 'A B', year: '2020', note: 'see 10.5555/n1' }), 0).doi).toBe('10.5555/n1');
  });

  it('keeps only https links that point at a PDF', () => {
    const base = { title: 'T', author: 'A B', year: '2020' };
    expect(toCandidate(entry('misc', { ...base, url: 'https://x.org/a.pdf' }), 0).pdfUrl).toBe('https://x.org/a.pdf');
    expect(toCandidate(entry('misc', { ...base, url: 'http://x.org/a.pdf' }), 0).pdfUrl).toBeNull();
    expect(toCandidate(entry('misc', { ...base, url: 'javascript:alert(1)//.pdf' }), 0).pdfUrl).toBeNull();
    expect(toCandidate(entry('misc', { ...base, url: 'https://x.org/page' }), 0).pdfUrl).toBeNull();
  });

  it('uses editors when there are no authors, and the date field for the year', () => {
    expect(toCandidate(entry('book', { title: 'T', editor: 'Doe, Jane', date: '2019-05-01' }), 0)).toMatchObject({ authors: ['Jane Doe'], year: 2019 });
  });

  it.each([
    [{ author: 'A B', year: '2020' }, 'No title'],
    [{ title: 'T', author: 'A B' }, 'No year'],
    [{ title: 'T', year: '2020' }, 'No authors'],
    [{ title: 'T'.repeat(600), author: 'A B', year: '2020' }, 'Invalid title: Too big: expected string to have <=500 characters'],
    [{ title: 'T', author: 'A B', year: '1850' }, 'Invalid year: Too small: expected number to be >=1900'],
    [{ title: 'T', author: 'A B', year: '2099' }, `Invalid year: Too big: expected number to be <=${new Date().getFullYear() + 1}`],
  ])('rejects %o: %s', (fields, reason) => {
    expect(toCandidate(entry('article', fields), 0)).toMatchObject({ status: 'invalid', reason });
  });
});
