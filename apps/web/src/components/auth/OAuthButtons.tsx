"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { config } from "@/lib/config";
import { safeInternalPath } from "@/lib/auth/redirects";

type Props = { next?: string; mode: "login" | "signup"; initialError?: string };

export function OAuthButtons({ next, mode, initialError }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  if (!config.google.authEnabled) return null;

  const handleGoogle = async () => {
    setPending(true);
    setError(null);
    try {
      const client = supabaseBrowser();
      const callback = new URL("/api/auth/callback", config.app.url);
      callback.searchParams.set("flow", mode);
      if (next) callback.searchParams.set("next", safeInternalPath(next));
      const { error: oauthError } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callback.toString() },
      });
      if (oauthError) {
        setError(oauthError.message);
        setPending(false);
      }
    } catch {
      setError("Could not start Google sign-in. Please try again.");
      setPending(false);
    }
  };

  return (
    <div className="oauth-buttons">
      <button
        type="button"
        className="oauth-button oauth-button--google"
        onClick={handleGoogle}
        disabled={pending}
      >
        {pending
          ? "Opening Google…"
          : mode === "signup"
            ? "Sign up with Google"
            : "Continue with Google"}
      </button>
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
