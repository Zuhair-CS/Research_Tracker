import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../../src/lib/csv.js';
import { HttpError, badGateway, badRequest, conflict, forbidden, notFound, unauthorized } from '../../src/lib/errors.js';
import { normalizeDoi, normalizeOrcid, orcidChecksumValid, orcidShape } from '../../src/lib/identifiers.js';
import { nameParts, namesMatch, normalizeText, titleKey } from '../../src/lib/names.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../../src/lib/password.js';

describe('normalizeDoi', () => {
  it.each([
    ['10.1000/XYZ123', '10.1000/xyz123'],
    ['  doi: 10.1000/abc ', '10.1000/abc'],
    ['https://doi.org/10.1038/nature12373', '10.1038/nature12373'],
    ['http://dx.doi.org/10.1002/(SICI)1097-4636', '10.1002/(sici)1097-4636'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeDoi(input)).toBe(expected);
  });

  it.each([
    'not-a-doi',
    '10.12/too-short-prefix',
    '10.1000/has space',
    '10.1000/a?query=1',
    '10.1000/a#frag',
    'https://evil.example/10.1000/x',
    `10.1000/${'a'.repeat(200)}`,
  ])('rejects %s (cannot break out of the URL path)', (input) => {
    expect(normalizeDoi(input)).toBeNull();
  });
});

describe('normalizeOrcid', () => {
  it('accepts valid iDs, with or without the URL, including an X check digit', () => {
    expect(normalizeOrcid('0000-0002-1825-0097')).toBe('0000-0002-1825-0097');
    expect(normalizeOrcid('https://orcid.org/0000-0002-1694-233x')).toBe('0000-0002-1694-233X');
    expect(normalizeOrcid('http://www.orcid.org/0000-0002-1825-0097')).toBe('0000-0002-1825-0097');
  });

  it('accepts iDs pasted with spaces, other dashes or no dashes', () => {
    expect(normalizeOrcid('0000 0002 1825 0097')).toBe('0000-0002-1825-0097');
    expect(normalizeOrcid('0000–0002—1825‐0097')).toBe('0000-0002-1825-0097');
    expect(normalizeOrcid('000000021694233x')).toBe('0000-0002-1694-233X');
  });

  it('tells "ORCID-shaped" input apart from names, regardless of the check digit', () => {
    expect(orcidShape('0000-0002-1825-0098')).toBe('0000-0002-1825-0098');
    expect(orcidShape('Ashok Pandey')).toBeNull();
    expect(orcidShape('0000-0002-1825')).toBeNull();
  });

  it('rejects a wrong check digit or format', () => {
    expect(normalizeOrcid('0000-0002-1825-0098')).toBeNull();
    expect(normalizeOrcid('0000-0002-1825')).toBeNull();
    expect(normalizeOrcid('0000-0002-1825-0097/works')).toBeNull();
    expect(orcidChecksumValid('0000-0002-1694-2330')).toBe(false);
  });
});

describe('names', () => {
  it('normalises accents, case and punctuation', () => {
    expect(normalizeText('  José  Pérez-Núñez! ')).toBe('jose perez nunez');
  });

  it('splits "Family, Given" and drops honorifics', () => {
    expect(nameParts('Pandey, Ashok')).toEqual({ family: 'pandey', first: 'ashok' });
    expect(nameParts('Dr. Prof. Gaurav Pandey')).toEqual({ family: 'pandey', first: 'gaurav' });
    expect(nameParts('Pandey')).toEqual({ family: 'pandey', first: '' });
    expect(nameParts('Dr.')).toBeNull();
  });

  it.each([
    ['Ashok Pandey', 'A. Pandey', true],
    ['Ashok Pandey', 'Pandey, Ashok', true],
    ['Ashok Kumar Pandey', 'Ashok K. Pandey', true],
    ['Dr. Ashok Pandey', 'Pandey', true],
    ['Ashok Pandey', 'Anil Pandey', false], // same initial, different first name
    ['Ashok Pandey', 'Shyam Pandey', false],
    ['Ashok Pandey', 'Ashok Sharma', false],
    ['', 'Ashok Pandey', false],
  ])('namesMatch(%s, %s) = %s', (a, b, expected) => {
    expect(namesMatch(a, b)).toBe(expected);
  });

  it('builds the same title key for the same paper from two sources', () => {
    expect(titleKey('Deep Learning: A <Review>', 2020)).toBe(titleKey('deep learning a review', 2020));
    expect(titleKey('X', null)).toBe('x|');
  });
});

describe('CSV', () => {
  it.each([
    ['=1+1', `"'=1+1"`],
    ['+cmd', `"'+cmd"`],
    ['-2', `"'-2"`],
    ['@SUM(A1)', `"'@SUM(A1)"`],
    ['\tTab', `"'\tTab"`],
    ['say "hi"', '"say ""hi"""'],
    [42, '"42"'],
    [null, ''],
    [undefined, ''],
  ])('csvCell(%j) = %s', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it('writes a BOM, CRLF line endings and a header row', () => {
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('﻿"a","b"\r\n"1","x"\r\n');
  });
});

describe('errors', () => {
  it.each([
    [badRequest('x'), 400, 'BAD_REQUEST'],
    [badRequest('x', 'CUSTOM'), 400, 'CUSTOM'],
    [unauthorized(), 401, 'UNAUTHORIZED'],
    [forbidden(), 403, 'FORBIDDEN'],
    [notFound(), 404, 'NOT_FOUND'],
    [conflict('x'), 409, 'CONFLICT'],
    [badGateway('x'), 502, 'UPSTREAM_ERROR'],
  ])('%o has status %i and code %s', (err, status, code) => {
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status, code, name: 'HttpError' });
  });
});

describe('passwords (argon2id)', () => {
  it('hashes with argon2id, salted, and verifies', async () => {
    const [a, b] = await Promise.all([hashPassword('a long passphrase'), hashPassword('a long passphrase')]);
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b); // random salt
    expect(await verifyPassword(a, 'a long passphrase')).toBe(true);
    expect(await verifyPassword(a, 'wrong')).toBe(false);
  });

  it('treats a corrupt hash as a failed check instead of crashing', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });

  it('the dummy check always fails (used for unknown e-mails)', async () => {
    expect(await verifyAgainstDummy('anything')).toBe(false);
    expect(await verifyAgainstDummy('anything')).toBe(false);
  });
});
