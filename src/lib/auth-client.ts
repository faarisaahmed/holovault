import { createAuthClient } from "better-auth/react";

/** Browser side of the auth API, served from /api/auth on the same origin. */
export const authClient = createAuthClient();
