import { Form, Link, redirect, useActionData } from "react-router";
import type { Route } from "./+types/reset-password";
import { getAuth } from "@/lib/server/auth.server";

export const meta: Route.MetaFunction = () => [{ title: "Choose a new password — Holovault" }];

export function loader({ request }: Route.LoaderArgs) {
  const token = new URL(request.url).searchParams.get("token");
  return { token };
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
  const input = "w-full rounded-md border border-ink-700 bg-ink-850 px-3 py-2 text-sm outline-none focus:border-accent";
  if (!loaderData.token) {
    return (
      <div className="mx-auto max-w-sm py-8 text-sm text-ink-300">
        This reset link is incomplete.{" "}
        <Link to="/login?mode=forgot" className="text-accent underline">
          Ask for a new one
        </Link>
        .
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-sm py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      {result?.error ? <p role="alert" className="mt-4 text-sm text-rose-300">{result.error}</p> : null}
      <Form method="post" className="mt-6 space-y-3">
        <input type="hidden" name="token" value={loaderData.token} />
        <input name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" placeholder="New password" className={input} />
        <input name="confirm" type="password" required maxLength={128} autoComplete="new-password" placeholder="Confirm" className={input} />
        <button className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-black">Save password</button>
      </Form>
      <p className="mt-3 text-[11px] text-ink-500">Every other signed-in device is signed out when you save.</p>
    </div>
  );
}
