import "server-only";
import { Resend } from "resend";
import { config } from "@/lib/config";

let client: Resend | null = null;

export function getResend(): Resend {
  if (client) return client;
  client = new Resend(config.resend.apiKey);
  return client;
}
