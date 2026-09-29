import { useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import type { Route } from "./+types/add-scan";
import { ConditionPicker, useStickyCondition } from "@/components/condition-picker";
import { finishShort } from "@/components/finish";
import { LiveScanner } from "@/components/live-scanner";
import { usd } from "@/lib/format";
import { photoPrint, preloadOcr, rankByLooks, readCard, type CardText } from "@/lib/ocr.client";
import { requireUser } from "@/lib/server/auth.server";
import { handleCardAction, type CardActionResult } from "@/lib/server/card-actions.server";
import { finishPrices, finishesFor } from "@/lib/server/catalog.server";
import { getSettings, ownedCounts } from "@/lib/server/collection.server";
import { matchScan } from "@/lib/server/scan.server";
import type { Region } from "@/lib/types";

export const meta: Route.MetaFunction = () => [{ title: "Scan cards — Shadowless" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const settings = await getSettings(user.id);
  return { region: settings.defaultRegion === "ja" ? "ja" : "en", defaultCondition: settings.defaultCondition };
}

export interface Candidate {
  id: string;
  name: string;
  setName: string;
  localId: string;
  officialCount: number;
  image: string | null;
  why: string;
  score: number;
  owned: number;
  finishes: { name: string; price: number | null }[];
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  if (form.get("intent") !== "match") {
    return (await handleCardAction(user.id, form)) ?? { error: "Unknown request." };
  }
  const field = (k: string, max: number) => String(form.get(k) ?? "").slice(0, max);
  const region: Region = form.get("region") === "ja" ? "ja" : "en";
  const { matches, guess, confident, offer } = matchScan(
    { title: field("title", 300), bottom: field("bottom", 1000), text: field("text", 8000), body: field("body", 3000) },
    region,
    16,
  );
  const ids = matches.map((m) => m.card.id);
  const prices = finishPrices(ids);
  const owned = await ownedCounts(user.id, ids);
  const candidates: Candidate[] = matches.map(({ card: c, why, score }) => {
    const p = prices.get(c.id);
    return {
      id: c.id,
      name: c.name,
      setName: c.setName,
      localId: c.localId,
      officialCount: c.officialCount,
      image: c.image,
      why,
      score,
      owned: [...(owned.get(c.id)?.values() ?? [])].reduce((a, b) => a + b, 0),
      finishes: finishesFor(c, p).map((f) => ({ name: f, price: p?.get(f) ?? (f === "Normal" || f === "Holofoil" ? c.marketPrice : null) })),
    };
  });
  return { candidates, guess, confident, offer };
}

interface Shot {
  key: number;
  url: string;
  file: File;
}

export default function ScanCards({ loaderData }: Route.ComponentProps) {
  const [region, setRegion] = useState<Region>(loaderData.region as Region);
  const [shots, setShots] = useState<Shot[]>([]);
  const [engine, setEngine] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const [condition, setCondition] = useStickyCondition(loaderData.defaultCondition);
  const next = useRef(1);
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);

  useEffect(() => preloadOcr((p) => setEngine(p), region === "ja" ? "ja" : "en"), [region]);
  // Free the photo previews when leaving the page.
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const fresh = [...files]
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, 30)
      .map((file) => {
        const url = URL.createObjectURL(file);
        urls.current.push(url);
        return { key: next.current++, url, file };
      });
    // Newest on top, so the card you just shot is right under your thumb.
    setShots((s) => [...fresh.reverse(), ...s]);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scan cards</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-400">
            Photograph a card and pick the match. It reads the name and the number in the bottom corner, right here on
            your device. Photos aren't uploaded or saved.
          </p>
        </div>
        <Link to="/add" className="ml-auto text-xs text-ink-400 underline hover:text-accent">
          Search by name instead
        </Link>
      </div>

      <div className="mb-5 rounded-xl border border-ink-800 bg-ink-900 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setLive(true)} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-black">
            Scan with live camera
          </button>
          <button onClick={() => camera.current?.click()} className="rounded-md border border-ink-700 px-4 py-2 text-sm text-ink-200 hover:border-accent">
            Take a photo
          </button>
          <button onClick={() => library.current?.click()} className="rounded-md border border-ink-700 px-4 py-2 text-sm text-ink-200 hover:border-accent">
            Choose photos
          </button>
          <div className="ml-auto inline-flex rounded-md border border-ink-700 bg-ink-850 p-0.5 text-xs">
            {(["en", "ja"] as const).map((r) => (
              <button key={r} onClick={() => setRegion(r)} className={`rounded px-2.5 py-1 font-medium ${region === r ? "bg-ink-700 text-ink-100" : "text-ink-400"}`}>
                {r === "en" ? "English" : "Japanese"}
              </button>
            ))}
          </div>
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
          <input ref={library} type="file" accept="image/*" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ""))} />
        </div>
        <div className="mt-3">
          <ConditionPicker value={condition} onChange={setCondition} label="Adding as" />
        </div>
        <ul className="mt-3 grid gap-1 text-[11px] text-ink-500 sm:grid-cols-3">
          <li>• Live camera: line one card up in the frame, tap Add, move to the next. Great for a binder page.</li>
          <li>• Good light, no glare across the name or the bottom corner.</li>
          <li>• Photos: fill most of the picture with the card. You can pick a batch at once.</li>
        </ul>
        {engine != null && engine < 1 ? (
          <p className="mt-2 text-[11px] text-ink-500">Getting the scanner ready… {Math.round(engine * 100)}%</p>
        ) : null}
      </div>

      {live ? <LiveScanner region={region} defaultCondition={condition} onClose={() => setLive(false)} /> : null}

      {shots.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-700 px-4 py-14 text-center text-sm text-ink-400">
          Your scans show up here. Japanese cards match by their number and set code.
        </p>
      ) : (
        <ul className="space-y-3">
          {shots.map((s) => (
            <ScanRow key={s.key} shot={s} region={region} condition={condition} onRemove={() => setShots((all) => all.filter((x) => x.key !== s.key))} />
          ))}
        </ul>
      )}
    </>
  );
}

type Status = "queued" | "reading" | "matching" | "done" | "failed";

/** Scans run one at a time; this chains them. */
let queue: Promise<unknown> = Promise.resolve();

function ScanRow({ shot, region, condition, onRemove }: { shot: Shot; region: Region; condition: string; onRemove: () => void }) {
  const match = useFetcher<typeof action>();
  const [status, setStatus] = useState<Status>("queued");
  const [read, setRead] = useState<CardText | null>(null);
  const [thorough, setThorough] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const submit = match.submit;

  useEffect(() => {
    let live = true;
    queue = queue.then(async () => {
      if (!live) return;
      setStatus("reading");
      try {
        const t = await readCard(shot.file, thorough, region === "ja" ? "ja" : "en");
        if (!live) return;
        setRead(t);
        setStatus("matching");
      } catch {
        if (live) setStatus("failed");
      }
    });
    return () => {
      live = false;
    };
  }, [shot.file, thorough, region]);

  // Re-match when the text arrives or the language switch changes.
  useEffect(() => {
    if (!read) return;
    void submit({ intent: "match", title: read.title, bottom: read.bottom, text: read.text ?? "", region }, { method: "post" });
  }, [read, region, submit]);

  // The quick read found nothing certain: read the whole photo once, slowly.
  const result = match.data && "candidates" in match.data ? match.data : null;
  const needsThorough = !!result && !result.confident && !thorough && match.state === "idle" && status === "matching";
  if (needsThorough) setThorough(true);

  const data = match.data && "candidates" in match.data ? match.data : null;
  const [ranked, setRanked] = useState<{ for: Candidate[]; list: Candidate[] } | null>(null);

  // Break ties between printings of the same name by comparing the photo's
  // colours with each candidate's artwork. A read number still wins.
  useEffect(() => {
    const list = data?.candidates;
    if (!list || list.length < 2) return;
    let live = true;
    (async () => {
      const mine = await photoPrint(shot.file).catch(() => null);
      if (!mine) return;
      const ordered = await rankByLooks(mine, list);
      if (live) setRanked({ for: list, list: ordered });
    })();
    return () => {
      live = false;
    };
  }, [data?.candidates, shot.file]);

  const candidates = (ranked && ranked.for === data?.candidates ? ranked.list : data?.candidates) ?? [];
  const shown = showAll ? candidates : candidates.slice(0, 4);
  const busy = status === "queued" || status === "reading" || match.state !== "idle" || (status === "matching" && !data);

  return (
    <li className="rounded-xl border border-ink-800 bg-ink-900 p-3" data-ocr={import.meta.env.DEV && read ? `${read.title} || ${read.bottom} || ${read.text ?? ""}` : undefined}>
      <div className="flex gap-3">
        <img src={shot.url} alt="Your photo" className="h-28 w-20 shrink-0 rounded-md object-cover ring-1 ring-ink-700" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="text-sm">
              {added ? (
                <span className="text-good">Added {added}</span>
              ) : status === "failed" ? (
                <span className="text-rose-300">Couldn't read this photo. Try again closer, with less glare.</span>
              ) : busy ? (
                <span className="text-ink-400">{status === "queued" ? "Waiting…" : status === "reading" ? "Reading the card…" : "Finding it…"}</span>
              ) : candidates.length ? (
                <span className="text-ink-300">Which one is it?</span>
              ) : (
                <span className="text-ink-400">No match. Try a sharper photo, or search for it.</span>
              )}
            </div>
            <button onClick={onRemove} className="ml-auto text-xs text-ink-500 hover:text-ink-200" aria-label="Remove scan">
              ✕
            </button>
          </div>
          {!busy && !added && (candidates.length === 0 || status === "failed") ? (
            <Link to={`/add${data?.guess ? `?q=${encodeURIComponent(data.guess)}` : ""}`} className="mt-2 inline-block text-xs text-accent underline">
              Search{data?.guess ? ` for “${data.guess}”` : ""}
            </Link>
          ) : null}
        </div>
      </div>
      {!busy && !added && candidates.length ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {shown.map((c, i) => (
              <CandidateCard key={c.id} c={c} best={i === 0 && candidates.length > 1} condition={condition} onAdded={setAdded} />
            ))}
          </div>
          {candidates.length > shown.length ? (
            <button onClick={() => setShowAll(true)} className="mt-2 text-xs text-ink-400 underline">
              {candidates.length - shown.length} more possible matches
            </button>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

function CandidateCard({ c, best, condition, onAdded }: { c: Candidate; best: boolean; condition: string; onAdded: (label: string) => void }) {
  const add = useFetcher<CardActionResult>();
  useEffect(() => {
    if (add.state === "idle" && add.data && "added" in add.data) {
      const a = add.data.added;
      onAdded(`${a.name} · ${finishShort(a.finish)} · ${a.label}`);
    }
  }, [add.state, add.data, onAdded]);
  const error = add.data && "error" in add.data ? add.data.error : null;
  return (
    <div className={`flex flex-col rounded-lg p-1.5 ${best ? "bg-accent/10 ring-1 ring-accent/40" : ""}`}>
      {c.image ? (
        <img src={c.image} alt={c.name} loading="lazy" className="aspect-[245/342] w-full rounded-md object-cover ring-1 ring-ink-800" />
      ) : (
        <div className="grid aspect-[245/342] place-items-center rounded-md bg-ink-850 text-[10px] text-ink-500">{c.name}</div>
      )}
      <div className="mt-1.5 truncate text-xs text-ink-100">{c.name}</div>
      <div className="truncate text-[10px] text-ink-500">
        {c.setName} · {c.localId}
        {c.officialCount ? `/${c.officialCount}` : ""}
      </div>
      <div className="truncate text-[10px] text-ink-600">
        {best ? "Best match · " : ""}
        {c.owned ? `you have ${c.owned}` : c.why}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {c.finishes.map((f) => (
          <add.Form method="post" key={f.name}>
            <input type="hidden" name="intent" value="add" />
            <input type="hidden" name="cardId" value={c.id} />
            <input type="hidden" name="finish" value={f.name} />
            <input type="hidden" name="condition" value={condition} />
            <button disabled={add.state !== "idle"} className="rounded border border-ink-700 bg-ink-850 px-2 py-1 text-[11px] text-ink-200 hover:border-accent hover:text-accent disabled:opacity-50">
              + {finishShort(f.name)} <span className="text-ink-500">{usd(f.price, { compact: true })}</span>
            </button>
          </add.Form>
        ))}
      </div>
      {error ? <p className="mt-1 text-[10px] text-rose-300">{error}</p> : null}
    </div>
  );
}
