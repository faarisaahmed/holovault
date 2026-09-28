import type { Config } from "@react-router/dev/config";

/**
 * React Router refuses a form submission whose Origin header doesn't match
 * the URL it sees. Behind Render's proxy the app sees http://, while the
 * browser sends https://, so every form looked cross-site and was rejected
 * with "Bad Request". Allowing the site's own host (from BETTER_AUTH_URL,
 * which Render provides at build time too) fixes that without opening it to
 * any other domain.
 */
function siteHost(): string[] {
  try {
    return process.env.BETTER_AUTH_URL ? [new URL(process.env.BETTER_AUTH_URL).host] : [];
  } catch {
    return [];
  }
}

export default {
  // Keeps the existing src/ layout rather than moving everything to app/.
  appDirectory: "src",
  // Every page reads SQLite at request time, so it all renders on the server.
  ssr: true,
  allowedActionOrigins: siteHost(),
} satisfies Config;
