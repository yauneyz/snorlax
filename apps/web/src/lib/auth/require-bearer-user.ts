import "server-only";
import type { NextRequest } from "next/server";
import { extractBearerToken } from "@talysman/auth-contracts";
import { supabaseAdmin } from "@/lib/supabase/admin";

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export async function requireBearerUser(request: NextRequest) {
  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) throw new UnauthorizedError("Missing bearer token");

  const {
    data: { user },
    error,
  } = await supabaseAdmin().auth.getUser(token);

  if (error || !user) throw new UnauthorizedError("Invalid bearer token");
  return user;
}
