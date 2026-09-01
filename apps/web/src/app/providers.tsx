"use client";
import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { config } from "@/lib/config";
import { captureException } from "@/lib/sentry";
import { recoveryRedirectForAuthEvent } from "@/lib/auth/recovery";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { trackEvent } from "@/lib/analytics/posthog-client";

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

function AnalyticsPageview({ posthogReady }: { posthogReady: boolean }) {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname.startsWith("/insights")) return;
    let referrerHost: string | undefined;
    try {
      referrerHost = document.referrer ? new URL(document.referrer).hostname : undefined;
    } catch {
      referrerHost = undefined;
    }
    void trackEvent("page_viewed", {
      path: pathname,
      title: document.title,
      ...(referrerHost ? { referrer_host: referrerHost } : {}),
    });
  }, [pathname]);

  useEffect(() => {
    if (!posthogReady || pathname.startsWith("/insights")) return;
    const query = window.location.search.replace(/^\?/, "");
    const url = window.location.origin + pathname + (query ? `?${query}` : "");
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, posthogReady]);
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
          // Identify by opaque user id only — deliberately no email. `analytics_events.user_id`
          // joins to `profiles` when an address is actually needed, so copying one into a
          // third-party analytics store buys nothing and puts PII somewhere we do not control.
          posthog.identify(session.user.id);
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
      ui_host: config.posthog.uiHost, // host above is the reverse proxy; links must point at real PostHog
      capture_pageview: false, // App Router: manual tracking via PostHogPageview
      person_profiles: "identified_only",
      enable_heatmaps: true,
      // maskAllInputs is PostHog's default, but set explicitly: this app has a documented
      // no-PII-in-PostHog policy (analytics-plan.md §14) and signup/login forms share this
      // same provider tree, so replay must never surface typed email/password values.
      session_recording: { maskAllInputs: true },
    });
    setPosthogReady(true);
  }, []);

  const tree = (
    <QueryClientProvider client={queryClient}>
      <SupabaseAuthSync />
      <AnalyticsPageview posthogReady={posthogReady} />
      {children}
      {config.app.environment === "development" ? <ReactQueryDevtools /> : null}
    </QueryClientProvider>
  );

  if (!config.posthog.key) return tree;
  return (
    <PostHogProvider client={posthog}>
      {tree}
    </PostHogProvider>
  );
}
