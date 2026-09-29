import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { CardActionResult } from "@/lib/server/card-actions.server";
import { framePrint, likeness, rankByLooks, readStrips } from "@/lib/ocr.client";
import { parseScanText } from "@/lib/scan";
import { usd } from "@/lib/format";
import type { Region } from "@/lib/types";
import type { Candidate } from "@/routes/add-scan";
import { ConditionPicker, useStickyCondition } from "./condition-picker";
import { finishShort } from "./finish";

/**
 * Binder mode: the camera stays open, only the card inside the on-screen
 * frame is read, and each match pops up to confirm with one tap. After an
 * add it waits for the view to change (you moved to the next pocket) before
 * reading again, so the same card is never offered twice in a row.
 */

type Phase = "starting" | "scanning" | "confirm" | "moved-on" | "error";

/** Card proportions, 63 × 88 mm. */
const CARD_RATIO = 63 / 88;
/** TCGdex's small image loads fast enough for the confirm panel. */
const thumb = (url: string) => url.replace(/\/high\.(webp|png|jpg)$/, "/low.webp");

/** Average per-pixel change (0–255) below which the camera counts as still. */
const STEADY = 10;

/** How different the view must look before the next card is read. */
const MOVED_BELOW = 0.8;

interface MatchData {
  candidates: Candidate[];
  guess: string | null;
  confident: boolean;
  offer: "sure" | "choose" | "wait";
}

export function LiveScanner({ region, defaultCondition, onClose }: { region: Region; defaultCondition: string; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [phase, setPhaseState] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [options, setOptions] = useState<Candidate[]>([]);
  const [pick, setPick] = useState(0);
  const [sure, setSure] = useState(true);
  const [added, setAdded] = useState<{ id: string; label: string }[]>([]);
  const [condition, setCondition] = useStickyCondition(defaultCondition);
  const match = useFetcher<MatchData>();
  const add = useFetcher<CardActionResult>();
  const undo = useFetcher();

  // Mutable scan state the loop reads without re-rendering.
  const busy = useRef(false);
  const lastPrint = useRef<Float32Array | null>(null);
  const skipIds = useRef(new Set<string>());
  const snapshot = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef<Phase>("starting");
  // The scan loop reads the phase between renders, so keep a ref in step.
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const moveOn = useCallback(
    (message: string) => {
      lastPrint.current = snapshot.current ? framePrint(snapshot.current) : null;
      setOptions([]);
      setHint(message);
      setPhase("moved-on");
    },
    [setPhase],
  );

  // Camera on, and off again when the scanner closes.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // As sharp as the camera allows: the collector number is only a few
          // millimetres tall.
          video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
          audio: false,
        });
        if (cancelled) return;
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        setPhase("scanning");
      } catch (err) {
        setError(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Camera access was blocked. Allow it for this site in your browser settings, then try again."
            : "Couldn't open the camera on this device. Use Take a photo instead.",
        );
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [setPhase]);

  /** The part of the video inside the on-screen frame, as a card-sized canvas. */
  const grab = useCallback((width = 1000): HTMLCanvasElement | null => {
    const v = video.current;
    const f = frame.current;
    if (!v || !f || !v.videoWidth) return null;
    const vb = v.getBoundingClientRect();
    const fb = f.getBoundingClientRect();
    // The video fills its box like object-fit: cover.
    const scale = Math.max(vb.width / v.videoWidth, vb.height / v.videoHeight);
    const ox = (vb.width - v.videoWidth * scale) / 2;
    const oy = (vb.height - v.videoHeight * scale) / 2;
    const sx = (fb.left - vb.left - ox) / scale;
    const sy = (fb.top - vb.top - oy) / scale;
    const sw = fb.width / scale;
    const sh = fb.height / scale;
    const c = document.createElement("canvas");
    c.width = Math.round(Math.min(sw, width));
    c.height = Math.round(c.width / CARD_RATIO);
    c.getContext("2d")!.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }, []);

  // The loop, every 120 ms: wait for the camera to hold still, then read the
  // name and number strips. After an add, wait for the view to change.
  const matchState = useRef(match.state);
  useEffect(() => {
    matchState.current = match.state;
  }, [match.state]);
  const submitMatch = match.submit;
  const steady = useRef({ prev: null as Uint8ClampedArray | null, count: 0 });
  const reads = useRef(0);
  const wantBody = useRef(false);
  useEffect(() => {
    if (phase !== "scanning" && phase !== "moved-on") return;
    let stop = false;
    const tick = async () => {
      if (stop || busy.current || matchState.current !== "idle") return;
      const small = grab(36);
      if (!small) return;
      if (phaseRef.current === "moved-on") {
        const now = framePrint(small);
        if (!lastPrint.current || likeness(now, lastPrint.current) < MOVED_BELOW) {
          skipIds.current.clear();
          attempts.current.clear();
          wantBody.current = false;
          steady.current.count = 0;
          setPhase("scanning");
          setHint(null);
        }
        return;
      }
      // Blurry frames read as nonsense; only read once the picture settles.
      const px = small.getContext("2d")!.getImageData(0, 0, small.width, small.height).data;
      const prev = steady.current.prev;
      let diff = 0;
      if (prev && prev.length === px.length) {
        for (let i = 0; i < px.length; i += 4) diff += Math.abs(px[i] - prev[i]) + Math.abs(px[i + 1] - prev[i + 1]);
        diff /= px.length / 2;
      } else diff = 255;
      steady.current.prev = px;
      steady.current.count = diff < STEADY ? steady.current.count + 1 : 0;
      if (steady.current.count < 2) return;

      busy.current = true;
      try {
        const card = grab(1600);
        if (!card) return;
        // After an unsure result, also read the attacks for this card.
        const read = await readStrips(card, reads.current++, wantBody.current);
        if (stop) return;
        const totals = new Set(parseScanText(read.bottom).numbers.filter((n) => n.total != null).map((n) => `${n.local}/${n.total}`));
        if (totals.size > 1) {
          setHint("Only one card in the frame at a time.");
          return;
        }
        if (read.title.trim().length < 3 && !totals.size) return;
        snapshot.current = card;
        void submitMatch(
          { intent: "match", title: read.title, bottom: read.bottom, body: read.body ?? "", region },
          { method: "post", action: "/add/scan" },
        );
      } finally {
        busy.current = false;
      }
    };
    const id = setInterval(tick, 120);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [phase, grab, submitMatch, region, setPhase]);

  // A match came back. Sure → ask right away. Not sure → keep looking, and
  // after a few reads that agree on the name, offer the printings by artwork.
  const handled = useRef<MatchData | null>(null);
  const attempts = useRef(new Map<string, number>());
  useEffect(() => {
    const data = match.data;
    if (!data || match.state !== "idle" || handled.current === data || phaseRef.current !== "scanning") return;
    handled.current = data;
    const list = data.candidates.filter((c) => !skipIds.current.has(c.id));
    const top = list[0];
    if (!top) return;
    // Count repeat sightings by name, or by the leading card when no name read.
    const key = data.guess ?? top.id;
    const seen = (attempts.current.get(key) ?? 0) + 1;
    attempts.current.set(key, seen);
    wantBody.current = data.offer === "wait";
    if (data.offer === "wait" && seen < 3) {
      setHint(seen > 1 ? "Almost: tilt away from glare so the name and number are sharp." : null);
      return;
    }
    (async () => {
      let ordered = list;
      const shot = snapshot.current;
      // No number to go on: the frame crops exactly to the card, so its
      // colours pick between printings of the name.
      if (data.offer === "wait" && shot) ordered = await rankByLooks(framePrint(shot), list, 50);
      if (phaseRef.current !== "scanning") return;
      setSure(data.confident);
      setOptions(ordered.slice(0, 6));
      setPick(0);
      setHint(null);
      setPhase("confirm");
    })();
  }, [match.data, match.state, setPhase]);

  // Added: count it, remember the view, wait for the next pocket.
  const addHandled = useRef<CardActionResult | null>(null);
  useEffect(() => {
    const d = add.data;
    if (!d || add.state !== "idle" || addHandled.current === d) return;
    addHandled.current = d;
    if (!("added" in d)) return;
    const a = d.added;
    queueMicrotask(() => {
      setAdded((list) => [{ id: a.id, label: `${a.name} · ${finishShort(a.finish)} · ${a.label}` }, ...list]);
      moveOn(`Added ${a.name}. Move to the next card.`);
    });
  }, [add.data, add.state, moveOn]);

  const skip = () => {
    options.forEach((c) => skipIds.current.add(c.id));
    moveOn("Skipped. Move to the next card.");
  };

  const undoLast = () => {
    const last = added[0];
    if (!last) return;
    undo.submit({ intent: "undo", id: last.id, quantity: "1" }, { method: "post", action: "/add/scan" });
    setAdded((list) => list.slice(1));
  };

  const card = options[pick];

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
        {/* Darken everything outside the frame so it's obvious what gets read. */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div
            ref={frame}
            className={`relative aspect-[63/88] h-[62%] max-w-[78%] rounded-xl border-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] transition-colors ${
              phase === "confirm" ? "border-good" : phase === "moved-on" ? "border-white/40" : "border-white"
            }`}
          />
        </div>
        <div className="absolute inset-x-0 top-0 flex items-start gap-2 p-3">
          <div className="rounded-lg bg-black/60 px-3 py-2 text-xs leading-snug">
            <div className="font-semibold">One card in the frame</div>
            <div className="text-white/70">Fill the outline, hold still. Tilt away from glare.</div>
          </div>
          <button onClick={onClose} className="ml-auto rounded-full bg-black/60 px-3 py-1.5 text-sm font-semibold">
            Done{added.length ? ` · ${added.length}` : ""}
          </button>
        </div>
        {phase === "starting" ? <p className="absolute inset-x-0 top-1/2 text-center text-sm text-white/80">Opening camera…</p> : null}
        {phase === "error" ? (
          <p className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-lg bg-black/80 p-4 text-center text-sm">{error}</p>
        ) : null}
        {hint && phase !== "confirm" ? (
          <p className="absolute inset-x-0 bottom-3 mx-auto w-fit max-w-[90%] rounded-full bg-black/70 px-4 py-2 text-center text-xs">{hint}</p>
        ) : null}
        {phase === "scanning" && !hint ? (
          <p className="absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-black/50 px-4 py-2 text-xs text-white/80">
            {match.state !== "idle" ? "Checking…" : "Looking for a card…"}
          </p>
        ) : null}
      </div>

      {phase === "confirm" && card ? (
        <div className="h-[17rem] shrink-0 overflow-y-auto border-t border-white/10 bg-ink-950 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] text-ink-100">
          <div className="flex gap-3">
            {card.image ? <img src={thumb(card.image)} alt="" className="h-28 w-20 shrink-0 rounded-md object-cover ring-1 ring-ink-700" /> : null}
            <div className="min-w-0 flex-1">
              <div className="text-xs text-ink-400">{sure ? "Is this the card?" : "Couldn't read the number. Which one is it?"}</div>
              <div className="truncate text-base font-semibold">{card.name}</div>
              <div className="truncate text-xs text-ink-400">
                {card.setName} · {card.localId}
                {card.officialCount ? `/${card.officialCount}` : ""}
                {card.owned ? ` · you have ${card.owned}` : ""}
              </div>
              <div className="mt-2">
                <ConditionPicker value={condition} onChange={setCondition} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {card.finishes.map((f) => (
                  <button
                    key={f.name}
                    disabled={add.state !== "idle"}
                    onClick={() =>
                      add.submit({ intent: "add", cardId: card.id, finish: f.name, condition }, { method: "post", action: "/add/scan" })
                    }
                    className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
                  >
                    Add {finishShort(f.name)} <span className="font-normal text-black/60">{usd(f.price, { compact: true })}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          {options.length > 1 ? (
            <div className="mt-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-500">Not it? Tap the right one</div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {options.map((c, i) => (
                  <button key={c.id} onClick={() => setPick(i)} className={`shrink-0 rounded-md p-0.5 ${i === pick ? "ring-2 ring-accent" : "opacity-70"}`} title={`${c.name} · ${c.setName}`}>
                    {c.image ? <img src={thumb(c.image)} alt={c.name} className="h-16 w-12 rounded object-cover" /> : <span className="block h-16 w-12 rounded bg-ink-800 text-[9px]">{c.name}</span>}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-2 flex items-center gap-3 text-xs">
            <button onClick={skip} className="rounded-md border border-ink-700 px-3 py-2 text-ink-200">
              Skip this card
            </button>
            {added.length ? (
              <button onClick={undoLast} className="text-ink-400 underline">
                Undo last ({added[0].label})
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex h-[17rem] shrink-0 flex-col justify-end gap-3 border-t border-white/10 bg-ink-950 px-3 py-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] text-xs text-ink-300">
          <p className="text-sm text-ink-300">
            Line the card up with the outline. When it's recognised, it pops up here: tap Add, then move to the next
            pocket.
          </p>
          <ConditionPicker value={condition} onChange={setCondition} label="Adding as" />
          <div className="flex items-center gap-3">
          <span>{added.length ? `${added.length} added this session` : "Nothing added yet"}</span>
          {added.length ? (
            <button onClick={undoLast} className="ml-auto text-ink-400 underline">
              Undo {added[0].label}
            </button>
          ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
