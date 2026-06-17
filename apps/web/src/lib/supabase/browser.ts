"use client";
import { createBrowserClient } from "@supabase/ssr";
import { config } from "@/lib/config";

// Singleton-per-tab client. Safe to call from many components; the underlying
// storage is the browser's cookie + localStorage.
let client: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  if (client) return client;
  client = createBrowserClient(config.supabase.url, config.supabase.publishableKey);
  return client;
}
