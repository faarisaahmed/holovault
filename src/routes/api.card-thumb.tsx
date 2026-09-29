import type { Route } from "./+types/api.card-thumb";
import { requireUser } from "@/lib/server/auth.server";

/**
 * Small card images, served from this site so the scanner can read their
 * colours. Some image hosts send a duplicated CORS header on part of their
 * catalog, which browsers reject; going through here sidesteps that. Only the
 * two catalog image hosts are allowed.
 */
const HOSTS = ["https://assets.tcgdex.net/", "https://tcgplayer-cdn.tcgplayer.com/"];

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);
  const raw = new URL(request.url).searchParams.get("url") ?? "";
  if (!HOSTS.some((h) => raw.startsWith(h)) || raw.includes("..")) {
    return new Response("Not an allowed image", { status: 400 });
  }
  // The smallest variant each host offers is plenty for a colour histogram.
  const url = raw.replace(/\/high\.(webp|png|jpg)$/, "/low.webp").replace(/_in_1000x1000\.jpg$/, "_200w.jpg");
  const upstream = await fetch(url, { headers: { "User-Agent": "Shadowless/0.1 (personal collection tracker)" } }).catch(() => null);
  const type = upstream?.headers.get("content-type") ?? "";
  if (!upstream?.ok || !type.startsWith("image/")) return new Response("Image unavailable", { status: 502 });
  return new Response(upstream.body, {
    headers: { "Content-Type": type, "Cache-Control": "private, max-age=604800", "X-Content-Type-Options": "nosniff" },
  });
}
