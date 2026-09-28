/** Short labels for TCGplayer printings, for chips and badges. */
export const FINISH_SHORT: Record<string, string> = {
  Normal: "Normal",
  Holofoil: "Holo",
  "Reverse Holofoil": "Reverse",
  Unlimited: "Unlimited",
  "Unlimited Holofoil": "Unl. Holo",
  "1st Edition": "1st Ed",
  "1st Edition Holofoil": "1st Ed Holo",
};

export function finishShort(f: string): string {
  return FINISH_SHORT[f] ?? f;
}

/** Condition or grade as one badge: "NM", "PSA 10". */
export function copyLabel(i: { condition: string | null; grader: string | null; grade: string | number | null }): string {
  if (i.grader) return `${i.grader}${i.grade != null ? ` ${Number(i.grade)}` : ""}`;
  return i.condition ?? "NM";
}

export function CopyBadge(i: { condition: string | null; grader: string | null; grade: string | number | null }) {
  const graded = !!i.grader;
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${
        graded ? "bg-accent/15 text-accent ring-1 ring-accent/30" : "bg-ink-800 text-ink-300 ring-1 ring-ink-700"
      }`}
    >
      {copyLabel(i)}
    </span>
  );
}
