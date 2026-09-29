import { useState } from "react";
import { NavLink, useLocation } from "react-router";

type Item = { to: string; label: string; end?: boolean };

const ICONS: Record<string, React.ReactNode> = {
  "/": <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />,
  "/add": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  "/collection": (
    <>
      <rect x="4" y="3" width="11" height="15" rx="1.5" />
      <path d="M18 6.5 20 7v13.5a1 1 0 0 1-1.2 1L8 19.5" />
    </>
  ),
  "/binders": (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M12 3v18M4 9h16M4 15h16" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="19" cy="12" r="1.3" />
    </>
  ),
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

const PRIMARY = ["/", "/add", "/collection", "/binders"];

/**
 * Phones get a thumb-reachable tab bar instead of the top menu, with the
 * less-used pages behind "More".
 */
export function MobileNav({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const [lastPath, setLastPath] = useState(pathname);
  // Close the sheet whenever the page changes (adjusted during render).
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  const primary = PRIMARY.map((to) => items.find((i) => i.to === to)).filter((i): i is Item => !!i);
  const rest = items.filter((i) => !PRIMARY.includes(i.to));
  const restActive = rest.some((i) => pathname === i.to || pathname.startsWith(`${i.to}/`));
  const tab = (active: boolean) =>
    `flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[10px] font-medium ${active ? "text-accent" : "text-ink-400"}`;

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-ink-800 bg-ink-900 px-4 pb-[calc(env(safe-area-inset-bottom)+4.5rem)] pt-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-700" />
            <div className="grid grid-cols-2 gap-2">
              {rest.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  className={({ isActive }) =>
                    `rounded-lg border px-3 py-3 text-sm ${isActive ? "border-accent bg-accent/10 text-accent" : "border-ink-800 bg-ink-850 text-ink-200"}`
                  }
                >
                  {i.label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t border-ink-800 bg-ink-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {primary.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => tab(isActive && !open)}>
            <Icon name={i.to} />
            {i.to === "/add" ? "Add" : i.label}
          </NavLink>
        ))}
        <button onClick={() => setOpen((o) => !o)} className={tab(open || restActive)} aria-expanded={open}>
          <Icon name="more" />
          More
        </button>
      </nav>
    </>
  );
}
