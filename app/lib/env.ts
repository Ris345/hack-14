import "server-only";

/**
 * Read a required variable, failing loudly. These are read lazily rather than at
 * module scope: `next build` evaluates route modules, and a missing variable
 * should break a request, not the build.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export const googleClientId = () => required("GOOGLE_CLIENT_ID");
export const googleClientSecret = () => required("GOOGLE_CLIENT_SECRET");

/** Signs the session and OAuth-transaction cookies. `openssl rand -hex 32`. */
export const sessionSecret = () =>
  new TextEncoder().encode(required("SESSION_SECRET"));

/** Public origin of this app. Must match the Google redirect URI's origin. */
export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export const redirectUri = () => `${appUrl()}/api/auth/callback`;

/** Cookies are Secure only over HTTPS — localhost is plain HTTP in dev. */
export const cookieSecure = () => appUrl().startsWith("https://");
