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

/** you.com API key, from https://you.com/platform. Sent as the `X-API-Key` header. */
export const ydcApiKey = () => required("YDC_API_KEY");

/** Encrypts the stored Luma login (`luma-session.ts`). `openssl rand -hex 32`. */
export const sessionSecret = () =>
  new TextEncoder().encode(required("SESSION_SECRET"));

/**
 * Cookies are `Secure` when served over HTTPS: on Vercel, or wherever `APP_URL`
 * is an https origin. Local dev is plain HTTP, where a Secure cookie would be
 * dropped by some browsers.
 */
export const cookieSecure = () =>
  process.env.VERCEL === "1" || (process.env.APP_URL ?? "").startsWith("https://");
