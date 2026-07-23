"use client";
import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { config } from "@/lib/config";
import { captureException } from "@/lib/sentry";
import { recoveryRedirectForAuthEvent } from "@/lib/auth/recovery";
import { supabaseBrowser } from "@/lib/supabase/browser";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1 },
      mutations: {
        onError: (err) => {
          void captureException(err);
        },
      },
    },
  });
}

function PostHogPageview() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (!config.posthog.key) return;
    const url = window.location.origin + pathname + (searchParams.toString() ? `?${searchParams}` : "");
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);
  return null;
}

function SupabaseAuthSync() {
  useEffect(() => {
    const client = supabaseBrowser();
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      const recoveryRedirect = recoveryRedirectForAuthEvent(event);
      if (recoveryRedirect && window.location.pathname !== recoveryRedirect) {
        // Supabase falls back to its Site URL when a requested redirect is absent or rejected.
        // The client still exchanges the root-level ?code, so send that recovery session to the
        // password form instead of leaving the user on the marketing homepage.
        window.location.replace(recoveryRedirect);
        return;
      }
      if (event === "SIGNED_IN" && session?.user) {
        if (config.posthog.key) {
          posthog.identify(session.user.id, { email: session.user.email });
        }
      } else if (event === "SIGNED_OUT") {
        if (config.posthog.key) posthog.reset();
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const [posthogReady, setPosthogReady] = useState(false);

  useEffect(() => {
    if (!config.posthog.key) return;
    posthog.init(config.posthog.key, {
      api_host: config.posthog.host,
      capture_pageview: false, // App Router: manual tracking via PostHogPageview
      person_profiles: "identified_only",
    });
    setPosthogReady(true);
  }, []);

  const tree = (
    <QueryClientProvider client={queryClient}>
      <SupabaseAuthSync />
      {children}
      {config.app.environment === "development" ? <ReactQueryDevtools /> : null}
    </QueryClientProvider>
  );

  if (!config.posthog.key) return tree;
  return (
    <PostHogProvider client={posthog}>
      {posthogReady ? <PostHogPageview /> : null}
      {tree}
    </PostHogProvider>
  );
}
