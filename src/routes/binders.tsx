import { Link, redirect } from "react-router";
import type { Route } from "./+types/binders";
import { BinderForm } from "@/components/binder-form";
import { requireUser } from "@/lib/server/auth.server";
import { binderInput, createBinder, listBinders, toRecord } from "@/lib/server/binder.server";
import { listSets, listSpecies } from "@/lib/server/catalog.server";

export const meta: Route.MetaFunction = () => [{ title: "Binders — Holovault" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return {
    binders: await listBinders(user.id),
    sets: listSets().map((s) => ({ id: s.id, name: s.name, region: s.region, year: s.releaseDate?.slice(0, 4) ?? null })),
    species: listSpecies(),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const parsed = binderInput.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const id = await createBinder(user.id, toRecord(parsed.data));
  throw redirect(`/binders/${id}`);
}

export default function Binders({ loaderData, actionData }: Route.ComponentProps) {
  const { binders, sets, species } = loaderData;
  return (
    <>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Binders</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-400">
          Plan how your cards sit in a binder. Say “every Pokémon in Pokédex order, no rares, one each, in a 4×4
          binder” and it lays out every page — your cards in place, gaps showing what to find next.
        </p>
      </div>
      {binders.length ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {binders.map((b) => (
            <Link key={b.id} to={`/binders/${b.id}`} className="rounded-xl border border-ink-800 bg-ink-900 p-3 hover:border-ink-600">
              <div className="font-semibold">{b.name}</div>
              <div className="text-[11px] text-ink-500">
                {b.rows}×{b.cols} · {b.config.source === "pokedex" ? "Pokédex" : b.config.source === "collection" ? "My collection" : b.config.source === "set" ? "One set" : "One Pokémon"}
                {b.config.excludeRares ? " · no rares" : ""}
                {b.config.onePerPokemon ? " · one per Pokémon" : ""}
              </div>
            </Link>
          ))}
        </div>
      ) : null}
      <h2 className="mb-2 text-sm font-semibold text-ink-200">New binder</h2>
      {actionData?.error ? <p className="mb-2 text-sm text-rose-300">{actionData.error}</p> : null}
      <BinderForm sets={sets} species={species} submitLabel="Create binder" />
    </>
  );
}
