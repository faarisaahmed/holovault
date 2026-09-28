import { useState } from "react";
import { Form } from "react-router";
import { LAYOUTS, type BinderConfig } from "@/lib/binder";

const SOURCES = [
  { value: "collection", label: "My collection", help: "Cards you own, one pocket each." },
  { value: "pokedex", label: "Pokédex", help: "One pocket per Pokémon, #1 onward; empty pockets show what to find." },
  { value: "set", label: "A set", help: "Every card in one set, owned or not." },
  { value: "pokemon", label: "One Pokémon", help: "Every card of one Pokémon." },
] as const;

const SORTS = [
  { value: "dex", label: "Pokédex number" },
  { value: "set", label: "Set & number" },
  { value: "name", label: "Name" },
  { value: "value", label: "Value (highest first)" },
  { value: "rarity", label: "Rarity" },
];

export function BinderForm({
  initial,
  sets,
  species,
  submitLabel,
}: {
  initial?: { name: string; rows: number; cols: number; config: BinderConfig };
  sets: { id: string; name: string; region: string }[];
  species: { dexId: number; name: string }[];
  submitLabel: string;
}) {
  const [source, setSource] = useState<string>(initial?.config.source ?? "pokedex");
  const cfg = initial?.config;
  const field = "rounded-md border border-ink-700 bg-ink-850 px-2 py-1.5 text-xs";
  const check = (name: string, label: string, on: boolean | undefined, help: string) => (
    <label className="flex items-start gap-2 text-xs">
      <input type="checkbox" name={name} defaultChecked={on} className="mt-0.5 accent-[var(--color-accent)]" />
      <span>
        {label}
        <span className="block text-[10px] text-ink-500">{help}</span>
      </span>
    </label>
  );
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
            <label key={s.value} className={`cursor-pointer rounded-lg border px-3 py-2 text-xs ${source === s.value ? "border-accent bg-accent/10" : "border-ink-700"}`}>
              <input type="radio" name="source" value={s.value} checked={source === s.value} onChange={() => setSource(s.value)} className="sr-only" />
              <span className="font-semibold">{s.label}</span>
              <span className="mt-0.5 block text-[10px] text-ink-500">{s.help}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {source === "set" ? (
        <label className="text-xs text-ink-400">
          Set
          <select name="setId" defaultValue={cfg?.setId} required className={`${field} mt-1 block w-full`}>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.region === "ja" ? "🇯🇵 " : ""}
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {source === "pokemon" ? (
        <label className="text-xs text-ink-400">
          Pokémon
          <select name="dexId" defaultValue={cfg?.dexId} required className={`${field} mt-1 block w-full`}>
            {species.map((s) => (
              <option key={s.dexId} value={s.dexId}>
                #{s.dexId} {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="text-xs text-ink-400">
        Language
        <select name="region" defaultValue={cfg?.region ?? "en"} className={`${field} mt-1 block w-full`}>
          <option value="en">English</option>
          <option value="ja">Japanese</option>
        </select>
      </label>
      <label className="text-xs text-ink-400">
        Order
        <select name="sort" defaultValue={cfg?.sort ?? "dex"} className={`${field} mt-1 block w-full`}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-2 md:col-span-2 sm:grid-cols-2 lg:grid-cols-4">
        {check("excludeRares", "No rare cards", cfg?.excludeRares, "Leave out Double Rare and up (ex, V, full arts, secrets).")}
        {check("onePerPokemon", "One per Pokémon", cfg?.onePerPokemon, "A single pocket per Pokédex number.")}
        {check("pokemonOnly", "Pokémon only", cfg?.pokemonOnly, "Leave out Trainers and Energy.")}
        {check("breakPages", "New page per set / generation", cfg?.breakPages, "Start each group on a fresh page.")}
      </div>
      <div className="md:col-span-2">
        <button className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-black">{submitLabel}</button>
      </div>
    </Form>
  );
}
