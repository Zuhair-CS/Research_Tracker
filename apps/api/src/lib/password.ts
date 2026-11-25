import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';

/**
 * Password hashing with argon2id, the algorithm recommended by OWASP.
 *
 * SECURITY: argon2id is deliberately slow and memory-hungry. If the database
 * is ever stolen, each password guess costs the attacker real time and RAM,
 * which makes cracking millions of guesses impractical. A random "salt" is
 * added automatically, so two users with the same password get different hashes.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet minimum
 * (19 MiB memory, 2 iterations, 1 thread).
 */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

// A hash of a random value, used when the e-mail does not exist (see auth route).
let dummyHash: Promise<string> | undefined;

/**
 * SECURITY (user enumeration): when someone logs in with an unknown e-mail we
 * still run a full password check against this dummy hash. Both "wrong
 * e-mail" and "wrong password" then take the same time, so an attacker
 * cannot discover which e-mails have accounts by timing the response.
 */
export async function verifyAgainstDummy(plain: string): Promise<false> {
  dummyHash ??= argon2.hash(randomBytes(32).toString('hex'), OPTIONS);
  await verifyPassword(await dummyHash, plain);
  return false;
}
