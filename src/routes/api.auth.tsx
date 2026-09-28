import type { Route } from "./+types/api.auth";
import { getAuth } from "@/lib/server/auth.server";

/** Hands every /api/auth/* request (sign-in, sign-up, OAuth callbacks...) to Better Auth. */
export async function loader({ request }: Route.LoaderArgs) {
  return (await getAuth()).handler(request);
}

export async function action({ request }: Route.ActionArgs) {
  return (await getAuth()).handler(request);
}
