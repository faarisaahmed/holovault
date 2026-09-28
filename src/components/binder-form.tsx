import { useState } from "react";
import { Form } from "react-router";
import { BINDER_OPTIONS, LAYOUTS, type BinderConfig, type BinderSource } from "@/lib/binder";
import { SearchSelect } from "./search-select";

const SOURCES: { value: BinderSource; label: string; help: string }[] = [
  { value: "collection", label: "My collection", help: "Cards you own, one pocket each." },
  { value: "pokedex", label: "Pokédex", help: "One pocket per Pokémon, #1 onward; empty pockets show what to find." },
  { value: "set", label: "A set", help: "Every card in one set, owned or not." },
  { value: "pokemon", label: "One Pokémon", help: "Every card of one Pokémon." },
];

const SORT_LABELS: Record<BinderConfig["sort"], string> = {
  dex: "Pokédex number",
  set: "Set & number",
  release: "Release date (oldest first)",
  name: "Name",
  value: "Value (highest first)",
  rarity: "Rarity",
};

/** Label and explanation for each option, worded for the binder type. */
function flagCopy(flag: string, source: BinderSource): [string, string] {
  switch (flag) {
    case "excludeRares":
      return source === "pokemon"
        ? ["No rare cards", "Just the regular cards — no ex, V, full arts or secret rares."]
        : ["No rare cards", "Leave out Double Rare and up (ex, V, full arts, secrets)."];
    case "onePerPokemon":
      return ["One per Pokémon", "A single pocket per Pokédex number."];
    case "pokemonOnly":
      return ["Pokémon only", "Leave out Trainers and Energy."];
    case "noReprints":
      return ["Skip reprints", "When the same card was printed in several sets, keep one — yours, if you have it."];
    case "breakPages":
      return source === "pokedex"
        ? ["New page per generation", "Kanto, Johto, Hoenn… each start on a fresh page."]
        : ["New page per set", "Each set (or generation, in Pokédex order) starts on a fresh page."];
    default:
      return [flag, ""];
  }
}

export function BinderForm({
  initial,
  sets,
  species,
  submitLabel,
}: {
  initial?: { name: string; rows: number; cols: number; config: BinderConfig };
  sets: { id: string; name: string; region: string; year?: string | null }[];
  species: { dexId: number; name: string }[];
  submitLabel: string;
}) {
  const [source, setSource] = useState<BinderSource>(initial?.config.source ?? "pokedex");
  const cfg = initial?.config;
  const allowed = BINDER_OPTIONS[source];
  const field = "rounded-md border border-ink-700 bg-ink-850 px-2 py-1.5 text-xs";

  return (
    <Form method="post" className="grid gap-4 rounded-xl border border-ink-800 bg-ink-900 p-4 md:grid-cols-2">
      <input type="hidden" name="intent" value="save" />
      <label className="text-xs text-ink-400">
        Name
        <input name="name" required maxLength={60} defaultValue={initial?.name ?? "My binder"} className={`${field} mt-1 block w-full`} />
      </label>
      <label className="text-xs text-ink-400">
        Pages
        <select name="layout" defaultValue={initial ? `${initial.rows}x${initial.cols}` : "3x3"} className={`${field} mt-1 block w-full`}>
          {LAYOUTS.map((l) => (
            <option key={l.label} value={`${l.rows}x${l.cols}`}>
              {l.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="md:col-span-2">
        <legend className="mb-1 text-xs text-ink-400">Cards from</legend>
        <div className="grid gap-2 sm:grid-cols-4">
          {SOURCES.map((s) => (
            <label key={s.value} className={`cursor-pointer rounded-lg border px-3 py-2 text-xs ${source === s.value ? "border-accent bg-accent/10" : "border-ink-700 hover:border-ink-600"}`}>
              <input type="radio" name="source" value={s.value} checked={source === s.value} onChange={() => setSource(s.value)} className="sr-only" />
              <span className="font-semibold">{s.label}</span>
              <span className="mt-0.5 block text-[10px] text-ink-500">{s.help}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {source === "set" ? (
        <div className="text-xs text-ink-400">
          Set
          <SearchSelect
            key="set"
            name="setId"
            className="mt-1"
            defaultValue={cfg?.setId}
            placeholder="Type a set name, e.g. Evolving Skies"
            options={sets.map((s) => ({
              value: s.id,
              label: `${s.region === "ja" ? "🇯🇵 " : ""}${s.name}`,
              hint: s.year ?? undefined,
            }))}
          />
        </div>
      ) : null}
      {source === "pokemon" ? (
        <div className="text-xs text-ink-400">
          Pokémon
          <SearchSelect
            key="pokemon"
            name="dexId"
            className="mt-1"
            defaultValue={cfg?.dexId != null ? String(cfg.dexId) : undefined}
            placeholder="Type a name or number, e.g. Charizard or 6"
            options={species.map((s) => ({ value: String(s.dexId), label: s.name, hint: `#${s.dexId}` }))}
          />
        </div>
      ) : null}

      <label className="text-xs text-ink-400">
        Language
        <select name="region" defaultValue={cfg?.region ?? "en"} className={`${field} mt-1 block w-full`}>
          <option value="en">English</option>
          <option value="ja">Japanese</option>
        </select>
      </label>
      {allowed.sorts ? (
        <label className="text-xs text-ink-400">
          Order
          <select
            key={source}
            name="sort"
            defaultValue={cfg && allowed.sorts.includes(cfg.sort) ? cfg.sort : allowed.sorts[0]}
            className={`${field} mt-1 block w-full`}
          >
            {allowed.sorts.map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="self-end text-[11px] text-ink-500">Always in Pokédex order, one pocket per Pokémon.</p>
      )}

      <div className="grid gap-2 md:col-span-2 sm:grid-cols-2 lg:grid-cols-4">
        {allowed.flags.map((flag) => {
          const [label, help] = flagCopy(flag, source);
          return (
            <label key={`${source}-${flag}`} className="flex items-start gap-2 text-xs">
              <input type="checkbox" name={flag} defaultChecked={cfg?.[flag]} className="mt-0.5 accent-[var(--color-accent)]" />
              <span>
                {label}
                <span className="block text-[10px] text-ink-500">{help}</span>
              </span>
            </label>
          );
        })}
      </div>
      <div className="md:col-span-2">
        <button className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-black">{submitLabel}</button>
      </div>
    </Form>
  );
}
