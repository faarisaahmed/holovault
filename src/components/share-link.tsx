import { useState, useSyncExternalStore } from "react";

const noop = () => () => {};
import { useFetcher } from "react-router";

/**
 * "Share: off" / a copyable read-only link with Turn off. Posts intent=share
 * (on=1|0) to the current route.
 */
export function ShareLink({ path, what, extra }: { path: string | null; what: string; extra?: React.ReactNode }) {
  const f = useFetcher();
  const [copied, setCopied] = useState(false);
  const busy = f.state !== "idle";
  // The server doesn't know the public address; the browser fills it in.
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => "");
  const url = path ? `${origin}${path}` : null;
  if (!path) {
    return (
      <f.Form method="post" className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
        <input type="hidden" name="intent" value="share" />
        <input type="hidden" name="on" value="1" />
        {extra}
        <button disabled={busy} className="rounded-md border border-ink-700 px-3 py-1.5 text-ink-200 hover:border-accent">
          Share {what}
        </button>
        <span>Makes a read-only link. No prices paid, notes or account details are shown.</span>
      </f.Form>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs">
      <span className="text-ink-300">Anyone with this link can view {what}:</span>
      <code className="max-w-full truncate rounded bg-ink-900 px-2 py-1 text-ink-100">{url}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(url ?? "").then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="rounded-md bg-accent px-2.5 py-1 font-semibold text-black"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <f.Form method="post">
        <input type="hidden" name="intent" value="share" />
        <input type="hidden" name="on" value="0" />
        <button disabled={busy} className="text-ink-400 underline hover:text-rose-300">
          Turn off
        </button>
      </f.Form>
    </div>
  );
}
