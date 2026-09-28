import { useState } from "react";
import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/reset-password";
import { Alert, Field, PasswordInput, StrengthMeter } from "@/components/auth-fields";
import { AuthShell } from "@/components/auth-shell";
import { getAuth } from "@/lib/server/auth.server";
import { showcaseCards } from "@/lib/server/showcase.server";

export const meta: Route.MetaFunction = () => [{ title: "Choose a new password — Holovault" }];

/** Full-screen page: no site header or footer. */
export const handle = { bare: true };

export function loader({ request }: Route.LoaderArgs) {
  const token = new URL(request.url).searchParams.get("token");
  return { token, showcase: showcaseCards() };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  if (password.length < 10) return { error: "Use at least 10 characters." };
  if (password !== String(form.get("confirm") ?? "")) return { error: "The passwords don't match." };
  try {
    await (await getAuth()).api.resetPassword({ body: { newPassword: password, token } });
  } catch {
    return { error: "That link has expired or was already used. Ask for a new one." };
  }
  throw redirect("/login?reset=1");
}

export default function ResetPassword({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  return (
    <AuthShell showcase={loaderData.showcase}>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      {!loaderData.token ? (
        <p className="mt-3 text-sm text-ink-300">
          This reset link is incomplete.{" "}
          <Link to="/login?mode=forgot" className="text-accent underline">
            Ask for a new one
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-sm text-ink-400">Every other signed-in device is signed out when you save.</p>
          <div className="mt-6">{result?.error ? <Alert tone="error">{result.error}</Alert> : null}</div>
          <Form method="post" className="mt-4 space-y-4">
            <input type="hidden" name="token" value={loaderData.token} />
            <Field label="New password" hint={<StrengthMeter password={password} />}>
              <PasswordInput name="password" required minLength={10} maxLength={128} autoComplete="new-password" placeholder="At least 10 characters" value={password} onChange={setPassword} autoFocus />
            </Field>
            <Field
              label="Confirm password"
              hint={confirm ? (confirm === password ? <span className="text-good">✓ Passwords match</span> : <span className="text-rose-300">Doesn't match yet</span>) : undefined}
            >
              <PasswordInput name="confirm" required maxLength={128} autoComplete="new-password" value={confirm} onChange={setConfirm} />
            </Field>
            <button disabled={busy} className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-black shadow-lg shadow-accent/20 hover:brightness-110 disabled:opacity-50">
              Save password
            </button>
          </Form>
        </>
      )}
    </AuthShell>
  );
}
