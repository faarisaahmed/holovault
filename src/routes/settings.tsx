import { Form, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/settings";
import { CONDITIONS } from "@/lib/valuation";
import { authFeatures, getAuth, requireUser } from "@/lib/server/auth.server";
import { getSettings, saveSettings, settingsInput } from "@/lib/server/collection.server";
import { sealedEnabled, setSealedEnabled } from "@/lib/server/sealed.server";
import { collectionShare, setCollectionShare } from "@/lib/server/share.server";
import { ShareLink } from "@/components/share-link";
import { safeNext } from "@/lib/server/safe-redirect";

export const meta: Route.MetaFunction = () => [{ title: "Settings — Shadowless" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const auth = await getAuth();
  const [accounts, sessions, settings, sealed, share] = await Promise.all([
    auth.api.listUserAccounts({ headers: request.headers }),
    auth.api.listSessions({ headers: request.headers }),
    getSettings(user.id),
    sealedEnabled(user.id),
    collectionShare(user.id),
  ]);
  const providers = accounts.map((a) => a.providerId);
  return {
    user: { name: user.name, email: user.email, emailVerified: user.emailVerified },
    hasPassword: providers.includes("credential"),
    hasGoogle: providers.includes("google"),
    sessionCount: sessions.length,
    settings,
    sealed,
    share,
    features: authFeatures(),
  };
}

type Result = { section: string; ok?: string; error?: string };

/** Forwards Better Auth's cookie changes (sign-out, deletion) onto a redirect. */
function redirectWith(res: Response, to: string) {
  const headers = new Headers({ Location: to });
  for (const c of res.headers.getSetCookie()) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

async function message(res: Response, fallback: string) {
  try {
    return ((await res.json()) as { message?: string }).message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function action({ request }: Route.ActionArgs): Promise<Response | Result> {
  const user = await requireUser(request);
  const auth = await getAuth();
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const headers = request.headers;

  switch (intent) {
    case "profile": {
      const name = String(form.get("name") ?? "").trim().slice(0, 60);
      if (!name) return { section: "profile", error: "Enter a name." };
      await auth.api.updateUser({ body: { name }, headers });
      return { section: "profile", ok: "Saved." };
    }
    case "password": {
      const current = String(form.get("current") ?? "");
      const next = String(form.get("next") ?? "");
      if (next.length < 10) return { section: "password", error: "Use at least 10 characters." };
      if (next !== String(form.get("confirm") ?? "")) return { section: "password", error: "The new passwords don't match." };
      const res = current
        ? await auth.api.changePassword({ body: { currentPassword: current, newPassword: next, revokeOtherSessions: true }, headers, asResponse: true })
        : await auth.api.setPassword({ body: { newPassword: next }, headers, asResponse: true });
      if (!res.ok) return { section: "password", error: await message(res, "Your current password isn't right.") };
      return redirectWith(res, "/settings?saved=password");
    }
    case "link-google": {
      const res = await auth.api.linkSocialAccount({
        body: { provider: "google", callbackURL: `${new URL(request.url).origin}/settings` },
        headers,
        asResponse: true,
      });
      if (!res.ok) return { section: "accounts", error: await message(res, "Couldn't start linking Google.") };
      const { url } = (await res.clone().json()) as { url: string };
      return redirectWith(res, url);
    }
    case "unlink-google": {
      const accounts = await auth.api.listUserAccounts({ headers });
      const google = accounts.find((a) => a.providerId === "google");
      if (!google) return { section: "accounts", error: "Google isn't linked." };
      const res = await auth.api.unlinkAccount({ body: { accountId: google.accountId }, headers, asResponse: true });
      if (!res.ok) return { section: "accounts", error: await message(res, "Set a password before unlinking Google, or you'd be locked out.") };
      return { section: "accounts", ok: "Google unlinked." };
    }
    case "sign-out-others": {
      await auth.api.revokeOtherSessions({ headers });
      return { section: "sessions", ok: "Signed out everywhere else." };
    }
    case "sign-out": {
      const res = await auth.api.signOut({ headers, asResponse: true });
      return redirectWith(res, "/");
    }
    case "share": {
      const on = form.get("on") === "1";
      await setCollectionShare(user.id, on, form.get("values") === "1");
      return { section: "share", ok: on ? "Your collection link is on." : "Sharing is off. The old link no longer works." };
    }
    case "sealed": {
      await setSealedEnabled(user.id, form.get("on") === "1");
      const next = form.get("next");
      if (next) throw redirect(safeNext(String(next), "/settings"));
      return { section: "sealed", ok: form.get("on") === "1" ? "Sealed inventory is on." : "Sealed inventory is off. Nothing you logged was deleted." };
    }
    case "preferences": {
      const parsed = settingsInput.safeParse(Object.fromEntries(form));
      if (!parsed.success) return { section: "preferences", error: parsed.error.issues[0]?.message ?? "Check the form." };
      await saveSettings(user.id, parsed.data);
      return { section: "preferences", ok: "Saved." };
    }
    case "delete": {
      if (String(form.get("confirm")) !== "DELETE") return { section: "delete", error: 'Type DELETE to confirm.' };
      const password = String(form.get("password") ?? "");
      const res = await auth.api.deleteUser({ body: password ? { password } : {}, headers, asResponse: true });
      if (!res.ok) {
        return {
          section: "delete",
          error: await message(res, "Couldn't delete the account. If you signed in a while ago, sign out and back in, then try again."),
        };
      }
      // Collection, binders, goals and settings go with the user (ON DELETE CASCADE).
      return redirectWith(res, "/?deleted=1");
    }
  }
  throw redirect("/settings");
}

export default function Settings({ loaderData: d, actionData }: Route.ComponentProps) {
  const r = actionData as Result | undefined;
  const busy = useNavigation().state !== "idle";
  const field = "w-full rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-sm outline-none focus:border-accent";
  const note = (section: string) =>
    r?.section === section ? (
      <p role="status" className={`mt-2 text-xs ${r.error ? "text-rose-300" : "text-good"}`}>
        {r.error ?? r.ok}
      </p>
    ) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Section title="Profile">
        <Form method="post" className="flex items-end gap-2">
          <input type="hidden" name="intent" value="profile" />
          <label className="flex-1 text-xs text-ink-400">
            Name
            <input name="name" defaultValue={d.user.name} maxLength={60} className={`${field} mt-1`} />
          </label>
          <button disabled={busy} className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-black">
            Save
          </button>
        </Form>
        <p className="mt-2 text-xs text-ink-500">
          Signed in as {d.user.email}
          {d.user.emailVerified ? " · verified" : ""}
        </p>
        {note("profile")}
      </Section>

      <Section title={d.hasPassword ? "Change password" : "Add a password"}>
        <Form method="post" className="grid gap-2 sm:grid-cols-3">
          <input type="hidden" name="intent" value="password" />
          {d.hasPassword ? (
            <input name="current" type="password" required autoComplete="current-password" placeholder="Current password" className={field} />
          ) : null}
          <input name="next" type="password" required minLength={10} maxLength={128} autoComplete="new-password" placeholder="New password (10+ characters)" className={field} />
          <input name="confirm" type="password" required maxLength={128} autoComplete="new-password" placeholder="Confirm new password" className={field} />
          <button disabled={busy} className="rounded-md border border-ink-700 px-3 py-1.5 text-sm hover:border-accent sm:col-span-3 sm:justify-self-start">
            {d.hasPassword ? "Change password" : "Add password"}
          </button>
        </Form>
        <p className="mt-2 text-xs text-ink-500">Changing your password signs you out on every other device.</p>
        {note("password")}
      </Section>

      {d.features.google ? (
        <Section title="Google">
          <Form method="post" className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink-300">{d.hasGoogle ? "Google is linked — you can sign in with it." : "Link Google to sign in with one click."}</span>
            <input type="hidden" name="intent" value={d.hasGoogle ? "unlink-google" : "link-google"} />
            <button disabled={busy || (d.hasGoogle && !d.hasPassword)} title={d.hasGoogle && !d.hasPassword ? "Add a password first so you can still sign in" : undefined} className="rounded-md border border-ink-700 px-3 py-1.5 text-sm hover:border-accent disabled:opacity-40">
              {d.hasGoogle ? "Unlink" : "Link Google"}
            </button>
          </Form>
          {note("accounts")}
        </Section>
      ) : null}

      <Section title="Where you're signed in">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-ink-300">
            {d.sessionCount} active session{d.sessionCount === 1 ? "" : "s"}
          </span>
          <Form method="post">
            <input type="hidden" name="intent" value="sign-out-others" />
            <button disabled={busy || d.sessionCount < 2} className="rounded-md border border-ink-700 px-3 py-1.5 text-xs hover:border-accent disabled:opacity-40">
              Sign out everywhere else
            </button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="sign-out" />
            <button className="rounded-md border border-ink-700 px-3 py-1.5 text-xs hover:border-accent">Sign out</button>
          </Form>
        </div>
        {note("sessions")}
      </Section>

      <Section title="Preferences">
        <Form method="post" className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="intent" value="preferences" />
          <label className="text-xs text-ink-400">
            Grading fee per card ($)
            <input name="gradingFee" inputMode="decimal" defaultValue={(d.settings.gradingFeeCents / 100).toFixed(2)} className={`${field} mt-1`} />
          </label>
          <label className="text-xs text-ink-400">
            Shipping & insurance per card ($)
            <input name="gradingShipping" inputMode="decimal" defaultValue={(d.settings.gradingShippingCents / 100).toFixed(2)} className={`${field} mt-1`} />
          </label>
          <label className="text-xs text-ink-400">
            Default condition for quick adds
            <select name="defaultCondition" defaultValue={d.settings.defaultCondition} className={`${field} mt-1`}>
              {CONDITIONS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink-400">
            Default card language
            <select name="defaultRegion" defaultValue={d.settings.defaultRegion} className={`${field} mt-1`}>
              <option value="en">English</option>
              <option value="ja">Japanese</option>
            </select>
          </label>
          <button disabled={busy} className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-black sm:justify-self-start">
            Save preferences
          </button>
        </Form>
        {note("preferences")}
      </Section>

      <Section title="Share your collection">
        <p className="mb-3 text-sm text-ink-300">
          A read-only page of your cards for friends or trades. Off by default; turning it off retires the link.
        </p>
        <ShareLink
          path={d.share.token ? `/s/c/${d.share.token}` : null}
          what="your collection"
          extra={
            <label className="flex items-center gap-1.5 text-ink-300">
              <input type="checkbox" name="values" value="1" defaultChecked={d.share.showValues} /> Show values
            </label>
          }
        />
        {note("share")}
      </Section>

      <Section title="Sealed inventory">
        <p className="text-sm text-ink-300">
          For buying and selling sealed product: log boxes, ETBs, tins and cases with what you paid, record sales, and
          watch prices with charts and buy / sell signals. Adds a Sealed tab; off by default.
        </p>
        <Form method="post" className="mt-3">
          <input type="hidden" name="intent" value="sealed" />
          <input type="hidden" name="on" value={d.sealed ? "0" : "1"} />
          <button disabled={busy} className={`rounded-md px-3 py-1.5 text-sm ${d.sealed ? "border border-ink-700 hover:border-accent" : "bg-accent font-semibold text-black"}`}>
            {d.sealed ? "Turn off" : "Turn on sealed inventory"}
          </button>
        </Form>
        {note("sealed")}
      </Section>

      <Section title="Your data">
        <p className="text-sm text-ink-300">
          Download everything in your collection. It's yours — take it anywhere.
        </p>
        <div className="mt-2 flex gap-2 text-xs">
          <a href="/export/csv" className="rounded-md border border-ink-700 px-3 py-1.5 hover:border-accent">
            Download CSV
          </a>
          <a href="/export/json" className="rounded-md border border-ink-700 px-3 py-1.5 hover:border-accent">
            Download JSON (with binders)
          </a>
        </div>
      </Section>

      <Section title="Delete account" danger>
        <p className="text-sm text-ink-300">
          Permanently deletes your account, collection, binders and settings. This can't be undone — download your data
          first if you want to keep it.
        </p>
        <Form method="post" className="mt-3 grid gap-2 sm:grid-cols-3">
          <input type="hidden" name="intent" value="delete" />
          {d.hasPassword ? <input name="password" type="password" required autoComplete="current-password" placeholder="Your password" className={field} /> : null}
          <input name="confirm" required placeholder='Type "DELETE"' autoComplete="off" className={field} />
          <button disabled={busy} className="rounded-md bg-rose-500 px-3 py-1.5 text-sm font-semibold text-white">
            Delete everything
          </button>
        </Form>
        {note("delete")}
      </Section>
    </div>
  );
}

function Section({ title, children, danger }: { title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <section className={`rounded-xl border p-4 ${danger ? "border-rose-500/30 bg-rose-500/5" : "border-ink-800 bg-ink-900"}`}>
      <h2 className="mb-3 text-sm font-semibold text-ink-100">{title}</h2>
      {children}
    </section>
  );
}
