import { argon2id, argon2Verify } from "hash-wasm";

/**
 * Argon2id password hashing (WASM implementation, so it runs on Node and Workers).
 * Parameters follow the OWASP Password Storage Cheat Sheet minimum for Argon2id:
 * m = 19 MiB, t = 2, p = 1. The encoded output stores the parameters, so they can be
 * raised later without invalidating existing hashes.
 */
export const ARGON2_PARAMS = { parallelism: 1, iterations: 2, memorySize: 19_456, hashLength: 32 } as const;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return argon2id({ password, salt, ...ARGON2_PARAMS, outputType: "encoded" });
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash: encodedHash });
  } catch {
    // Malformed hash: treat as a failed verification, never as an error that reveals details.
    return false;
  }
}
