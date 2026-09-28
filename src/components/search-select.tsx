import { useId, useMemo, useRef, useState } from "react";

export interface Option {
  value: string;
  label: string;
  /** Small grey text after the label, e.g. a year or Pokédex number. */
  hint?: string;
}

const fold = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9♀♂]+/g, " ").trim();

/**
 * A text box that filters a long list as you type, for picking one of
 * 1,025 Pokémon or 290 sets without scrolling. Arrow keys and Enter work;
 * the chosen value is posted in a hidden input named `name`.
 */
export function SearchSelect({
  name,
  options,
  defaultValue,
  placeholder,
  className = "",
}: {
  name: string;
  options: Option[];
  defaultValue?: string;
  placeholder?: string;
  className?: string;
}) {
  const initial = options.find((o) => o.value === defaultValue) ?? null;
  const [selected, setSelected] = useState<Option | null>(initial);
  const [text, setText] = useState(initial?.label ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const q = fold(text);
    if (!q || (selected && text === selected.label)) return options.slice(0, 50);
    const num = q.replace(/^#/, "");
    const starts: Option[] = [];
    const contains: Option[] = [];
    for (const o of options) {
      const l = fold(o.label);
      if (l.startsWith(q) || o.value === num) starts.push(o);
      else if (l.includes(q) || fold(o.hint ?? "").includes(q)) contains.push(o);
    }
    return [...starts, ...contains].slice(0, 50);
  }, [text, options, selected]);

  const choose = (o: Option) => {
    setSelected(o);
    setText(o.label);
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`}>
      <input type="hidden" name={name} value={selected?.value ?? ""} />
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={text}
        placeholder={placeholder}
        onFocus={(e) => {
          setOpen(true);
          e.currentTarget.select();
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setText(e.target.value);
          setSelected(null);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(matches.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && open && matches[active]) {
            e.preventDefault();
            choose(matches[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
        className="block w-full rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-xs text-ink-100 outline-none focus:border-accent"
      />
      {open && matches.length ? (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-ink-700 bg-ink-900 py-1 shadow-xl"
        >
          {matches.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 text-xs ${
                i === active ? "bg-accent/15 text-ink-100" : "text-ink-300"
              }`}
            >
              <span className="truncate">{o.label}</span>
              {o.hint ? <span className="shrink-0 text-[10px] text-ink-500">{o.hint}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {open && !matches.length ? (
        <div className="absolute z-40 mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-2.5 py-2 text-xs text-ink-500">
          No matches
        </div>
      ) : null}
    </div>
  );
}
