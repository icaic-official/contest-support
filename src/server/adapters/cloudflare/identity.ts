import { betterAuth, type BetterAuthOptions } from "better-auth";
import { username } from "better-auth/plugins/username";
import { isAPIError } from "better-auth/api";
import { AuthenticationError } from "../../authentication";
import { passwordHasher } from "./password";

export const IDENTITY_SESSION_SECONDS = 8 * 60 * 60;

export interface IdentitySession {
  accountId: string;
  identitySessionId: string;
}

export interface IdentityProvider {
  signIn(username: string, password: string): Promise<IdentitySession & { cookie: string }>;
  session(headers: Headers): Promise<IdentitySession | undefined>;
  signOut(headers: Headers): Promise<string>;
}

export interface IdentityOptions {
  origin: string;
  secret: string;
  secureCookies: boolean;
}

/**
 * Use only the server API. Never expose Better Auth's HTTP router: Minsky owns
 * account creation, reset authorization, CSRF checks, and mandatory changes.
 */
export function createBetterAuthIdentity(
  database: BetterAuthOptions["database"],
  options: IdentityOptions,
): IdentityProvider {
  const origin = new URL(options.origin);
  if (origin.origin !== options.origin || origin.username || origin.password) {
    throw new Error("Configure an explicit authentication origin.");
  }
  if (options.secureCookies && origin.protocol !== "https:") {
    throw new Error("Secure authentication requires HTTPS.");
  }
  if (!options.secureCookies && !["127.0.0.1", "localhost"].includes(origin.hostname)) {
    throw new Error("Insecure authentication is restricted to loopback development.");
  }
  if (options.secret.length < 32) throw new Error("Configure an authentication secret of at least 32 characters.");
  const cookieName = options.secureCookies ? "__Host-minsky-session" : "minsky-session";
  const clearCookie = `${cookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${options.secureCookies ? "; Secure" : ""}`;
  const auth = betterAuth({
    appName: "Minsky",
    database,
    baseURL: options.origin,
    secret: options.secret,
    trustedOrigins: [options.origin],
    // Database errors can include bound credentials. The HTTP adapter reports
    // a fixed error and must never publish Better Auth's internal error object.
    logger: { disabled: true },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      password: {
        hash: passwordHasher.hash,
        verify: ({ password, hash }) => passwordHasher.verify(password, hash),
      },
    },
    user: { modelName: "ba_user" },
    account: { modelName: "ba_account", accountLinking: { enabled: false } },
    verification: { modelName: "ba_verification" },
    session: {
      modelName: "ba_session",
      expiresIn: IDENTITY_SESSION_SECONDS,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    advanced: {
      // Better Auth otherwise adds its own __Secure- prefix before this exact
      // __Host- name. Secure remains explicit in the cookie attributes below.
      useSecureCookies: false,
      defaultCookieAttributes: { httpOnly: true, secure: options.secureCookies, sameSite: "strict", path: "/" },
      cookies: { session_token: { name: cookieName } },
    },
    plugins: [username({
      displayUsername: false,
      immutableUsername: true,
      minUsernameLength: 3,
      maxUsernameLength: 32,
      usernameValidator: (value) => /^[a-z0-9][a-z0-9_-]{2,31}$/.test(value),
    })],
  });

  function sessionCookie(headers: Headers): string {
    const cookie = headers.getSetCookie().find((value) => value.startsWith(`${cookieName}=`));
    if (!cookie) throw new Error("The identity service did not set its session cookie.");
    return cookie;
  }

  return {
    async signIn(accountUsername, password) {
      const result = await (async () => {
        try {
          return await auth.api.signInUsername({
            body: { username: accountUsername, password, rememberMe: true },
            headers: new Headers({ origin: options.origin }),
            returnHeaders: true,
          });
        } catch (error) {
          if (isAPIError(error) && [400, 401].includes(error.statusCode)) {
            throw new AuthenticationError(401, "Username or password is incorrect.");
          }
          throw new AuthenticationError(503, "The identity service is unavailable.");
        }
      })();
      const context = await auth.$context;
      const record = await context.internalAdapter.findSession(result.response.token);
      if (!record) throw new Error("The identity service did not create a login session.");
      return {
        accountId: record.user.id,
        identitySessionId: record.session.id,
        cookie: sessionCookie(result.headers),
      };
    },
    async session(headers) {
      const result = await auth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } });
      if (!result) return undefined;
      return { accountId: result.user.id, identitySessionId: result.session.id };
    },
    async signOut(headers) {
      await auth.api.signOut({ headers });
      return clearCookie;
    },
  };
}
