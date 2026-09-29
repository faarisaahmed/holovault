import {
  Form,
  Link,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useMatches,
  useRouteLoaderData,
} from "react-router";
import type { Route } from "./+types/root";
import "./app.css";
import { MobileNav } from "@/components/mobile-nav";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { THEME_INIT_SCRIPT } from "@/lib/themes";
import { getSessionUser } from "@/lib/server/auth.server";
import { lastIngest } from "@/lib/server/catalog.server";
import { ripwiseUrl } from "@/lib/server/graded.server";
import { sealedEnabled } from "@/lib/server/sealed.server";
import { hasNewUpdates } from "@/lib/server/updates.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getSessionUser(request);
  return {
    user: user ? { name: user.name, email: user.email } : null,
    // The sealed tab only shows for accounts that switched it on.
    sealed: user ? await sealedEnabled(user.id) : false,
    // A quiet dot on "What's new" until the user has looked.
    news: user ? await hasNewUpdates(user.id, user.createdAt ?? 0) : false,
    ingested: lastIngest(),
    ripwise: ripwiseUrl() ?? null,
  };
}

/**
 * Security headers on every page. The CSP allows inline scripts because the
 * theme is applied before first paint and React Router inlines its hydration
 * data; everything else is locked to this origin, card images excepted.
 */
export const headers: Route.HeadersFunction = () => {
  const h: Record<string, string> = {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // The card scanner uses the camera on this site only.
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=()",
  };
  if (process.env.NODE_ENV === "production") {
    h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
    h["Content-Security-Policy"] = [
      "default-src 'self'",
      "img-src 'self' data: blob: https://assets.tcgdex.net https://tcgplayer-cdn.tcgplayer.com",
      // wasm-unsafe-eval lets the on-device OCR engine (served from /ocr) run.
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
      "worker-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "form-action 'self' https://accounts.google.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; ");
  }
  return h;
};

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
];

export const meta: Route.MetaFunction = () => [
  { title: "Shadowless — your Pokémon TCG collection" },
  {
    name: "description",
    content:
      "Track your Pokémon cards by printing, condition and grade, see what they're worth, find the ones worth grading, and plan master sets and binders.",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/add", label: "Add cards" },
  { to: "/collection", label: "Collection" },
  { to: "/wishlist", label: "Wishlist" },
  { to: "/sets", label: "Sets" },
  { to: "/pokemon", label: "Pokémon" },
  { to: "/binders", label: "Binders" },
  { to: "/grading", label: "Grading" },
  { to: "/trade", label: "Trade" },
];

export default function App({ loaderData }: Route.ComponentProps) {
  const { user, ripwise, sealed, news } = loaderData;
  const nav = sealed ? [...NAV, { to: "/sealed", label: "Sealed" }] : NAV;
  // Pages like sign-in fill the whole screen with their own layout.
  const bare = useMatches().some((m) => (m.handle as { bare?: boolean } | undefined)?.bare);
  if (bare) return <Outlet />;
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:gap-6">
          <Link to="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            <span>Shadowless</span>
          </Link>
          {user ? (
            <nav className="-my-1 hidden min-w-0 flex-1 items-center gap-4 overflow-x-auto whitespace-nowrap py-1 text-sm text-ink-300 md:flex">
              {nav.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) => `transition-colors hover:text-accent ${isActive ? "text-accent" : ""}`}
                >
                  {n.label}
                </NavLink>
              ))}
            </nav>
          ) : null}
          <div className="ml-auto flex shrink-0 items-center gap-3">
            {user ? (
              <NavLink
                to="/whats-new"
                className={({ isActive }) => `relative hidden text-xs transition-colors hover:text-accent lg:block ${isActive ? "text-accent" : "text-ink-400"}`}
              >
                What's new
                {news ? <span className="absolute -right-2 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent" aria-label="New updates" /> : null}
              </NavLink>
            ) : null}
            <ThemeSwitcher />
            {user ? (
              <NavLink
                to="/settings"
                className="grid h-8 w-8 place-items-center rounded-full bg-ink-800 text-xs font-bold text-ink-100 ring-1 ring-ink-700 hover:ring-accent"
                title={`${user.name} — settings`}
                aria-label="Settings"
              >
                {(user.name || user.email).slice(0, 1).toUpperCase()}
              </NavLink>
            ) : (
              <Link to="/login" className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-black">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6">
        <Outlet />
      </main>
      {user ? (
        <MobileNav
          items={[...nav, { to: "/import", label: "Import" }, { to: "/settings", label: "Settings" }, { to: "/whats-new", label: "What's new", dot: news }]}
        />
      ) : null}
      <footer className="mx-auto max-w-[1400px] px-4 pb-24 pt-4 md:pb-10 text-[11px] leading-relaxed text-ink-400">
        <Link to="/whats-new" className="underline hover:text-ink-200">
          What's new
        </Link>
        {" · "}Your collection is private to your account and never shared or sold. No ads, no analytics.
        Card data from TCGdex, market prices from TCGplayer via TCGCSV. Condition discounts are
        estimates.
        {ripwise ? (
          <>
            {" "}Pull rates and pack odds for every set live on the sister site,{" "}
            <a href={ripwise} className="underline hover:text-ink-200">
              Ripwise
            </a>
            .
          </>
        ) : null}
        <br />
        Not produced by, endorsed by, or affiliated with Nintendo, Creatures Inc., GAME FREAK inc.,
        The Pokémon Company or TCGplayer. Pokémon and all related names are trademarks of their
        respective owners.
      </footer>
    </>
  );
}

/** The signed-in user from the root loader, for components deep in the tree. */
export function useUser() {
  return useRouteLoaderData<typeof loader>("root")?.user ?? null;
}

/** The sister site's address, when this deployment knows it. */
export function useRipwiseUrl() {
  return useRouteLoaderData<typeof loader>("root")?.ripwise ?? null;
}

export function SignOutButton() {
  return (
    <Form method="post" action="/settings">
      <input type="hidden" name="intent" value="sign-out" />
      <button className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-200 hover:border-accent">
        Sign out
      </button>
    </Form>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const is404 = isRouteErrorResponse(error) && error.status === 404;
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{is404 ? "Not found" : "Something went wrong"}</h1>
      <p className="mt-2 text-sm text-ink-400">
        {is404 ? "Nothing lives at this address." : "An unexpected error occurred while rendering this page."}
      </p>
      <Link to="/" className="mt-4 inline-block text-sm text-accent underline">
        Back home
      </Link>
    </div>
  );
}
