import {
  hashPassword as betterAuthHashPassword,
  verifyPassword as betterAuthVerifyPassword,
} from "better-auth/crypto";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

/** Keep Better Auth login and guarded D1 credential writes on the same format. */
export const passwordHasher: PasswordHasher = {
  hash: betterAuthHashPassword,
  async verify(password, hash) {
    // Reject malformed storage values before invoking the expensive operation.
    if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash)) return false;
    return betterAuthVerifyPassword({ password, hash });
  },
};

// Digits 2-9 and letters without I, O, l, o, so a printed password has no look-alike pairs.
const readableAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const readableLength = 16;

/**
 * Generate a password for a person to type from paper: 16 characters, about
 * 93 bits of entropy. Bytes at or above the largest multiple of the alphabet
 * size are discarded, so every character is equally likely.
 */
export function readablePassword(): string {
  const limit = 256 - (256 % readableAlphabet.length);
  let password = "";
  while (password.length < readableLength) {
    for (const value of crypto.getRandomValues(new Uint8Array(readableLength * 2))) {
      if (value < limit && password.length < readableLength) {
        password += readableAlphabet[value % readableAlphabet.length];
      }
    }
  }
  return password;
}

/** Generate a 256-bit secret without a predictable random source. */
export function randomSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
