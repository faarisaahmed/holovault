import { useState } from "react";

const input =
  "w-full rounded-lg border border-ink-700 bg-ink-900 px-3.5 py-2.5 text-sm text-ink-100 outline-none transition placeholder:text-ink-600 focus:border-accent focus:ring-2 focus:ring-accent/25";

export function Field({
  label,
  hint,
  aside,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-xs font-medium text-ink-300">
        {label}
        {aside}
      </span>
      {children}
      {hint ? <span className="mt-1.5 block text-[11px] text-ink-500">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={input} />;
}

/** Password box with a show/hide toggle. */
export function PasswordInput({
  value,
  onChange,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value?: string;
  onChange?: (v: string) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative block">
      <input
        {...rest}
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className={`${input} pr-16`}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 px-3 text-[11px] font-medium text-ink-400 hover:text-accent"
      >
        {shown ? "Hide" : "Show"}
      </button>
    </span>
  );
}

/**
 * A rough strength guide: length matters most, then mixing character kinds.
 * It nudges; the server's rule is simply 10+ characters.
 */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!pw) return { score: 0, label: "" };
  if (pw.length < 10) return { score: 1, label: "Too short" };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  const lengthPoints = pw.length >= 16 ? 2 : pw.length >= 12 ? 1 : 0;
  const score = Math.min(4, 1 + lengthPoints + (kinds >= 3 ? 1 : 0)) as 1 | 2 | 3 | 4;
  return { score, label: ["", "Too short", "Okay", "Strong", "Great"][score] };
}

export function StrengthMeter({ password }: { password: string }) {
  const { score, label } = passwordStrength(password);
  if (!password) return null;
  const tone = score <= 1 ? "bg-rose-400" : score === 2 ? "bg-amber-300" : "bg-good";
  return (
    <span className="mt-2 flex items-center gap-2" aria-live="polite">
      <span className="grid flex-1 grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-1 rounded-full ${i <= score ? tone : "bg-ink-800"}`} />
        ))}
      </span>
      <span className="w-16 text-right text-[11px] text-ink-400">{label}</span>
    </span>
  );
}

export function Alert({ tone, children }: { tone: "error" | "ok"; children: React.ReactNode }) {
  const styles =
    tone === "error"
      ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
      : "border-good/30 bg-good/10 text-good";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`flex gap-2 rounded-lg border px-3 py-2.5 text-sm ${styles}`}>
      <span aria-hidden>{tone === "error" ? "!" : "✓"}</span>
      <span>{children}</span>
    </p>
  );
}
