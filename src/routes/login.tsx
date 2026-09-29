import { useState } from "react";
import { Form, Link, redirect, useActionData, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/login";
import { authFeatures, getAuth, getSessionUser } from "@/lib/server/auth.server";
import { safeNext } from "@/lib/server/safe-redirect";
import { showcaseCards } from "@/lib/server/showcase.server";
import { AuthShell } from "@/components/auth-shell";
import { Alert, Field, PasswordInput, StrengthMeter, TextInput } from "@/components/auth-fields";

export const meta: Route.MetaFunction = () => [{ title: "Sign in — Shadowless" }];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  if (await getSessionUser(request)) throw redirect(safeNext(url.searchParams.get("next")));
  return { features: authFeatures(), showcase: showcaseCards() };
}

/** Full-screen page: no site header or footer. */
export const handle = { bare: true };

type ActionResult = { error?: string; notice?: string; mode?: "in" | "up" | "forgot" };

/** Copies Better Auth's session cookies onto our redirect. */
function withCookies(res: Response, to: string) {
  const headers = new Headers({ Location: to });
  for (const c of res.headers.getSetCookie()) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

async function errorOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; code?: string };
    return body.message || "Something went wrong. Try again.";
  } catch {
    return "Something went wrong. Try again.";
  }
}

export async function action({ request }: Route.ActionArgs): Promise<Response | ActionResult> {
  const auth = await getAuth();
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const next = safeNext(String(form.get("next") ?? ""));
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const origin = new URL(request.url).origin;

  if (intent === "google") {
    const res = await auth.api.signInSocial({
      body: { provider: "google", callbackURL: `${origin}${next}` },
      headers: request.headers,
      asResponse: true,
    });
    if (!res.ok) return { error: await errorOf(res), mode: "in" };
    const { url } = (await res.clone().json()) as { url: string };
    return withCookies(res, url);
  }

  if (intent === "sign-in") {
    const res = await auth.api.signInEmail({ body: { email, password }, headers: request.headers, asResponse: true });
    if (!res.ok) {
      // One message for every failure, so the form never reveals which emails have accounts.
      const code = ((await res.clone().json().catch(() => ({}))) as { code?: string }).code;
      if (code === "EMAIL_NOT_VERIFIED") {
        return { error: "Confirm your email first — we sent you a link when you signed up.", mode: "in" };
      }
      if (res.status === 429) return { error: "Too many attempts. Wait a minute and try again.", mode: "in" };
      return { error: "That email and password don't match an account.", mode: "in" };
    }
    return withCookies(res, next);
  }

  if (intent === "sign-up") {
    const name = String(form.get("name") ?? "").trim().slice(0, 60) || email.split("@")[0];
    if (password.length < 10) return { error: "Use at least 10 characters for your password.", mode: "up" };
    if (password !== String(form.get("confirm") ?? "")) return { error: "The passwords don't match.", mode: "up" };
    const res = await auth.api.signUpEmail({
      body: { email, password, name, callbackURL: `${origin}${next}` },
      headers: request.headers,
      asResponse: true,
    });
    if (!res.ok) {
      if (res.status === 429) return { error: "Too many attempts. Wait a minute and try again.", mode: "up" };
      return { error: await errorOf(res), mode: "up" };
    }
    if (authFeatures().email) {
      return { notice: `We sent a confirmation link to ${email}. Open it to finish signing up.`, mode: "in" };
    }
    return withCookies(res, next);
  }

  if (intent === "forgot") {
    await auth.api
      .requestPasswordReset({ body: { email, redirectTo: `${origin}/reset-password` }, headers: request.headers })
      .catch(() => null);
    // Same answer whether or not the account exists.
    return { notice: "If that email has an account, a reset link is on its way.", mode: "in" };
  }

  return { error: "Unknown request." };
}

export default function Login({ loaderData }: Route.ComponentProps) {
  const { features, showcase } = loaderData;
  const result = useActionData<typeof action>() as ActionResult | undefined;
  const [params] = useSearchParams();
  const busy = useNavigation().state !== "idle";
  const mode = (params.get("mode") as ActionResult["mode"]) ?? result?.mode ?? "in";
  const next = params.get("next") ?? "/";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const link = (m: string) => {
    const p = new URLSearchParams(params);
    p.set("mode", m);
    return `?${p.toString()}`;
  };

  const title = mode === "up" ? "Start your collection" : mode === "forgot" ? "Reset your password" : "Welcome back";
  const subtitle =
    mode === "up"
      ? "Free, and private to you. Takes a few seconds."
      : mode === "forgot"
        ? "Enter your email and we'll send you a link to choose a new password."
        : "Sign in to pick up your collection where you left it.";

  return (
    <AuthShell showcase={showcase}>
      {mode !== "forgot" ? (
        <div role="tablist" className="mb-8 grid grid-cols-2 rounded-lg border border-ink-800 bg-ink-900 p-1 text-sm">
          {[
            ["in", "Sign in"],
            ["up", "Create account"],
          ].map(([m, label]) => (
            <Link
              key={m}
              to={link(m)}
              replace
              role="tab"
              aria-selected={mode === m}
              className={`rounded-md py-2 text-center font-medium transition ${
                mode === m ? "bg-ink-700 text-ink-100 shadow" : "text-ink-400 hover:text-ink-200"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      ) : null}

      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1.5 text-sm text-ink-400">{subtitle}</p>

      <div className="mt-6 space-y-3">
        {result?.error ? <Alert tone="error">{result.error}</Alert> : null}
        {result?.notice ? <Alert tone="ok">{result.notice}</Alert> : null}
        {params.get("reset") ? <Alert tone="ok">Password saved. Sign in with your new one.</Alert> : null}
      </div>

      {features.google && mode !== "forgot" ? (
        <Form method="post" className="mt-6">
          <input type="hidden" name="intent" value="google" />
          <input type="hidden" name="next" value={next} />
          <button
            disabled={busy}
            className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5 text-sm font-medium text-ink-100 transition hover:border-ink-500 hover:bg-ink-850 disabled:opacity-50"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4">
              <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
              <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
              <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7H2.1a11 11 0 0 0 0 10z" />
              <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4z" />
            </svg>
            Continue with Google
          </button>
          <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-wider text-ink-600">
            <span className="h-px flex-1 bg-ink-800" /> or use email <span className="h-px flex-1 bg-ink-800" />
          </div>
        </Form>
      ) : (
        <div className="mt-6" />
      )}

      <Form method="post" className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="intent" value={mode === "up" ? "sign-up" : mode === "forgot" ? "forgot" : "sign-in"} />
        {mode === "up" ? (
          <Field label="Name">
            <TextInput name="name" autoComplete="name" maxLength={60} placeholder="Ash Ketchum" />
          </Field>
        ) : null}
        <Field label="Email">
          <TextInput name="email" type="email" required autoComplete="email" placeholder="you@example.com" autoFocus />
        </Field>
        {mode !== "forgot" ? (
          <Field
            label="Password"
            aside={
              mode === "in" && features.email ? (
                <Link to={link("forgot")} replace className="text-[11px] font-normal text-ink-400 hover:text-accent">
                  Forgot password?
                </Link>
              ) : null
            }
            hint={mode === "up" ? <StrengthMeter password={password} /> : undefined}
          >
            <PasswordInput
              name="password"
              required
              minLength={mode === "up" ? 10 : undefined}
              maxLength={128}
              autoComplete={mode === "up" ? "new-password" : "current-password"}
              placeholder={mode === "up" ? "At least 10 characters" : ""}
              value={password}
              onChange={setPassword}
            />
          </Field>
        ) : null}
        {mode === "up" ? (
          <Field
            label="Confirm password"
            hint={
              confirm ? (
                confirm === password ? (
                  <span className="text-good">✓ Passwords match</span>
                ) : (
                  <span className="text-rose-300">Doesn't match yet</span>
                )
              ) : undefined
            }
          >
            <PasswordInput name="confirm" required maxLength={128} autoComplete="new-password" value={confirm} onChange={setConfirm} />
          </Field>
        ) : null}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-black shadow-lg shadow-accent/20 transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "One moment…" : mode === "up" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in"}
        </button>
      </Form>

      {mode === "forgot" ? (
        <p className="mt-6 text-center text-xs text-ink-400">
          <Link to={link("in")} replace className="text-accent hover:underline">
            ← Back to sign in
          </Link>
        </p>
      ) : mode === "up" ? (
        <p className="mt-6 text-center text-[11px] leading-relaxed text-ink-500">
          Your collection is only ever visible to you. You can export or delete everything from Settings at any time.
        </p>
      ) : null}
    </AuthShell>
  );
}
