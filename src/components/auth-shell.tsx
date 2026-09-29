import { Link } from "react-router";

export interface Showcase {
  id: string;
  name: string;
  image: string;
}

const POINTS = [
  "Every printing, condition and grade, valued daily",
  "Know which cards are worth grading",
  "Master sets, Pokémon and binders, tracked to 100%",
];

/**
 * Split-screen frame for the sign-in pages: a holo-foil brand panel with real
 * chase cards on the left, the form on the right. On phones the panel
 * collapses to a compact header.
 */
export function AuthShell({ showcase, children }: { showcase: Showcase[]; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="holo-panel relative hidden overflow-hidden border-r border-ink-800 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Link to="/" className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          Shadowless
        </Link>

        <div className="relative mx-auto my-10 h-80 w-full max-w-lg">
          {showcase.slice(0, 3).map((c, i) => {
            // Position on the outer box, float on the inner one: the float
            // animation drives `translate`, which would override centring.
            const pose = [
              "left-0 top-8 -rotate-12 z-10",
              "left-1/2 top-0 -translate-x-1/2 z-20",
              "right-0 top-8 rotate-12 z-10",
            ][i];
            return (
              <div key={c.id} className={`absolute w-40 xl:w-44 ${pose}`}>
                <div className="float-slow" style={{ animationDelay: `${i * -2.3}s` }}>
                  <div className="holo-sheen rounded-xl shadow-2xl shadow-black/60 ring-1 ring-white/10">
                    <img src={c.image} alt={c.name} className="aspect-[245/342] w-full rounded-xl object-cover" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div>
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Know what your
            <br />
            collection is worth.
          </h2>
          <ul className="mt-5 space-y-2.5">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-2.5 text-sm text-ink-200">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-white/10 text-[11px] text-accent-soft">✓</span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="flex flex-col px-5 py-8 sm:px-10">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight lg:hidden">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          Shadowless
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
        <p className="text-center text-[11px] text-ink-500">
          Private by default · No ads · No tracking ·{" "}
          <Link to="/" className="underline hover:text-ink-300">
            About Shadowless
          </Link>
        </p>
      </main>
    </div>
  );
}
