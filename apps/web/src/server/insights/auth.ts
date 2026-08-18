import "server-only";
import { timingSafeEqual } from "node:crypto";
import { extractBearerToken } from "@talysman/auth-contracts";
import { config } from "@/lib/config";

export function hasValidInsightsBearer(authorization: string | null): boolean {
  const expected = config.insights.widgetApiKey;
  const token = extractBearerToken(authorization);
  if (!expected || !token) return false;

  const actualBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
