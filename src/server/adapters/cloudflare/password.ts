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

/** Generate a 256-bit secret without a predictable random source. */
export function randomSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
