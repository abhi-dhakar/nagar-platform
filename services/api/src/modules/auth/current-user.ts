import { auth } from "@nagar/auth";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";

export async function currentUserId(request: FastifyRequest): Promise<string | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  return session?.user.id ?? null;
}
