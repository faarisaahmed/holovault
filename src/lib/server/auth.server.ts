import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { redirect } from "react-router";
import { getUserDb } from "./db.server";
import { emailEnabled, sendEmail } from "./email.server";
import * as schema from "./schema";

/**
 * Accounts, via Better Auth. Passwords are hashed with scrypt, sessions are
 * httpOnly cookies, and state-changing requests are origin-checked.
 *
 * Choices worth knowing:
 *  - Google sign-in never silently joins an existing password account whose
 *    email is unverified (the pre-registration takeover); linking is explicit
 *    from Settings.
 *  - With email configured, password accounts must verify their address
 *    before signing in, and can reset a forgotten password.
 *  - Rate limits are tighter than default on the sign-in and sign-up routes.
 *  - Telemetry is off.
 */
async function build() {
  const db = await getUserDb();
  const mail = emailEnabled();
  const google =
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }
      : undefined;

  if (process.env.NODE_ENV === "production" && !process.env.BETTER_AUTH_SECRET) {
    throw new Error("BETTER_AUTH_SECRET is not set.");
  }

  return betterAuth({
    appName: "Shadowless",
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:5173",
    secret: process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-change-me-dev-only-secret",
    database: drizzleAdapter(db, { provider: "pg", schema }),
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      requireEmailVerification: mail,
      revokeSessionsOnPasswordReset: true,
      ...(mail
        ? {
            sendResetPassword: async ({ user, url }) =>
              sendEmail(
                user.email,
                "Reset your Shadowless password",
                `Someone asked to reset the password for this account. If it was you, open this link within the hour:\n\n${url}\n\nIf it wasn't, ignore this email; your password stays the same.`,
              ),
          }
        : {}),
    },
    ...(mail
      ? {
          emailVerification: {
            sendOnSignUp: true,
            autoSignInAfterVerification: true,
            sendVerificationEmail: async ({ user, url }) =>
              sendEmail(
                user.email,
                "Confirm your Shadowless email",
                `Confirm this address to finish creating your account:\n\n${url}\n\nIf you didn't sign up, ignore this email.`,
              ),
          },
        }
      : {}),
    socialProviders: google ? { google } : {},
    account: {
      accountLinking: {
        enabled: true,
        // Linking happens explicitly from Settings, never by trusting a
        // provider on first sign-in.
        trustedProviders: [],
      },
    },
    user: { deleteUser: { enabled: true } },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: process.env.NODE_ENV === "production",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
        "/forget-password": { window: 300, max: 3 },
        "/request-password-reset": { window: 300, max: 3 },
      },
    },
    advanced: {
      useSecureCookies: process.env.NODE_ENV === "production",
      // Render sits behind a proxy; take the client IP from its header so
      // rate limits apply per visitor, not to the proxy.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
  });
}

type Auth = Awaited<ReturnType<typeof build>>;
let _auth: Promise<Auth> | null = null;

export function getAuth(): Promise<Auth> {
  _auth ??= build();
  return _auth;
}

export function authFeatures() {
  return {
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    email: emailEnabled(),
  };
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
}

export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const auth = await getAuth();
  const s = await auth.api.getSession({ headers: request.headers });
  return s?.user ?? null;
}

/** For loaders and actions that need a signed-in user. */
export async function requireUser(request: Request): Promise<SessionUser> {
  const u = await getSessionUser(request);
  if (!u) {
    const next = new URL(request.url).pathname;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return u;
}
