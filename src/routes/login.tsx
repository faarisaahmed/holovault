import { Form, Link, redirect, useActionData, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/login";
import { authFeatures, getAuth, getSessionUser } from "@/lib/server/auth.server";
import { safeNext } from "@/lib/server/safe-redirect";

export const meta: Route.MetaFunction = () => [{ title: "Sign in — Holovault" }];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  if (await getSessionUser(request)) throw redirect(safeNext(url.searchParams.get("next")));
  return { features: authFeatures() };
}

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
  const { features } = loaderData;
  const result = useActionData<typeof action>() as ActionResult | undefined;
  const [params, setParams] = useSearchParams();
  const busy = useNavigation().state !== "idle";
  const mode = (params.get("mode") as ActionResult["mode"]) ?? result?.mode ?? "in";
  const next = params.get("next") ?? "/";
  const setMode = (m: string) => {
    const p = new URLSearchParams(params);
    p.set("mode", m);
    setParams(p, { replace: true });
  };

  const input =
    "w-full rounded-md border border-ink-700 bg-ink-850 px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-accent";

  return (
    <div className="mx-auto max-w-sm py-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        {mode === "up" ? "Create your account" : mode === "forgot" ? "Reset your password" : "Sign in"}
      </h1>
      <p className="mt-1 text-sm text-ink-400">
        {mode === "up"
          ? "Free. Your collection stays private to your account."
          : mode === "forgot"
            ? "We'll email you a link to choose a new password."
            : "Pick up your collection where you left it."}
      </p>

      {result?.error ? (
        <p role="alert" className="mt-4 rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-300">
          {result.error}
        </p>
      ) : null}
      {result?.notice ? (
        <p role="status" className="mt-4 rounded-md border border-good/30 bg-good/10 px-3 py-2 text-sm text-good">
          {result.notice}
        </p>
      ) : null}

      {features.google && mode !== "forgot" ? (
        <Form method="post" className="mt-6">
          <input type="hidden" name="intent" value="google" />
          <input type="hidden" name="next" value={next} />
          <button
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-ink-700 bg-ink-850 px-3 py-2 text-sm font-medium text-ink-100 hover:border-accent disabled:opacity-50"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4">
              <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
              <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z" />
              <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7H2.1a11 11 0 0 0 0 10z" />
              <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4z" />
            </svg>
            Continue with Google
          </button>
          <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-ink-600">
            <span className="h-px flex-1 bg-ink-800" /> or with email <span className="h-px flex-1 bg-ink-800" />
          </div>
        </Form>
      ) : (
        <div className="mt-6" />
      )}

      <Form method="post" className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="intent" value={mode === "up" ? "sign-up" : mode === "forgot" ? "forgot" : "sign-in"} />
        {mode === "up" ? (
          <label className="block">
            <span className="mb-1 block text-xs text-ink-400">Name</span>
            <input name="name" autoComplete="name" maxLength={60} className={input} />
          </label>
        ) : null}
        <label className="block">
          <span className="mb-1 block text-xs text-ink-400">Email</span>
          <input name="email" type="email" required autoComplete="email" className={input} />
        </label>
        {mode !== "forgot" ? (
          <label className="block">
            <span className="mb-1 block text-xs text-ink-400">Password</span>
            <input
              name="password"
              type="password"
              required
              minLength={mode === "up" ? 10 : undefined}
              maxLength={128}
              autoComplete={mode === "up" ? "new-password" : "current-password"}
              className={input}
            />
            {mode === "up" ? <span className="mt-1 block text-[11px] text-ink-500">At least 10 characters.</span> : null}
          </label>
        ) : null}
        {mode === "up" ? (
          <label className="block">
            <span className="mb-1 block text-xs text-ink-400">Confirm password</span>
            <input name="confirm" type="password" required maxLength={128} autoComplete="new-password" className={input} />
          </label>
        ) : null}
        <button
          disabled={busy}
          className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-black disabled:opacity-50"
        >
          {busy ? "One moment…" : mode === "up" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in"}
        </button>
      </Form>

      <div className="mt-5 space-y-1.5 text-center text-xs text-ink-400">
        {mode === "in" ? (
          <>
            <p>
              New here?{" "}
              <button onClick={() => setMode("up")} className="text-accent underline">
                Create an account
              </button>
            </p>
            {features.email ? (
              <p>
                <button onClick={() => setMode("forgot")} className="underline hover:text-accent">
                  Forgot your password?
                </button>
              </p>
            ) : null}
          </>
        ) : (
          <p>
            <button onClick={() => setMode("in")} className="text-accent underline">
              Back to sign in
            </button>
          </p>
        )}
        <p className="pt-2 text-[11px] text-ink-600">
          <Link to="/" className="hover:text-ink-400">
            What is Holovault?
          </Link>
        </p>
      </div>
    </div>
  );
}
