import { Link } from "react-router";
import type { Route } from "./+types/privacy";

export const meta: Route.MetaFunction = () => [
  { title: "Privacy — Shadowless" },
  { name: "description", content: "What Shadowless stores about you, why, and how to export or delete it." },
];

const UPDATED = "October 18, 2026";

export default function Privacy() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 text-sm leading-relaxed text-ink-300">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-100">Privacy</h1>
        <p className="mt-1 text-xs text-ink-500">Last updated {UPDATED}</p>
      </div>

      <p>
        Shadowless is a small, independent Pokémon card collection tracker. It stores only what it needs to run your
        account. It has no ads and no analytics, and it never sells or rents your information.
      </p>

      <Section title="What's stored">
        <li>
          <strong className="text-ink-100">Your account:</strong> name, email address, and a hashed password if you sign
          up with email. If you use Google sign-in, your name, email and profile picture from Google.
        </li>
        <li>
          <strong className="text-ink-100">Your collection:</strong> the cards, binders, wishlist, sealed product,
          purchases, sales and settings you add.
        </li>
        <li>
          <strong className="text-ink-100">Sign-in sessions:</strong> a session cookie, plus the IP address and browser
          name of each session so you can see and end them. Sessions expire after 30 days.
        </li>
        <li>
          <strong className="text-ink-100">On your device only:</strong> your colour palette, default condition and
          unsent trade drafts, in your browser&rsquo;s local storage.
        </li>
        <li>
          Photos you scan to add cards are read on your device and are never uploaded or saved.
        </li>
      </Section>

      <Section title="Who else is involved">
        <li>
          <strong className="text-ink-100">Render</strong> hosts the site and <strong className="text-ink-100">Neon</strong>{" "}
          hosts the database your account lives in.
        </li>
        <li>
          <strong className="text-ink-100">Google</strong>, only if you choose Google sign-in.
        </li>
        <li>
          <strong className="text-ink-100">Resend</strong> sends account emails, such as password resets, to your
          address.
        </li>
        <li>
          <strong className="text-ink-100">TCGplayer and eBay</strong>, only when you click a buy link. Those are
          affiliate links, so those sites may set their own cookies to credit Shadowless with a commission. Their own
          privacy policies apply there.
        </li>
      </Section>

      <Section title="Sharing">
        <li>
          Your collection is private. A binder or collection is only visible to others if you create a share link for
          it, and you can turn that link off at any time.
        </li>
      </Section>

      <Section title="Your choices">
        <li>
          Export everything as CSV or JSON from{" "}
          <Link to="/settings" className="text-accent underline">
            Settings
          </Link>
          .
        </li>
        <li>
          Delete your account from Settings. That permanently removes your account, collection and sessions.
        </li>
      </Section>

      <Section title="Children">
        <li>Shadowless is not directed at children under 13, and accounts are not knowingly created for them.</li>
      </Section>

      <p className="text-xs text-ink-500">
        If this policy changes, the date above changes with it. Questions:{" "}
        <a href="https://github.com/faarisaahmed/holovault/issues" className="underline hover:text-accent">
          open an issue on GitHub
        </a>
        .
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-ink-100">{title}</h2>
      <ul className="list-disc space-y-1.5 pl-5">{children}</ul>
    </section>
  );
}
