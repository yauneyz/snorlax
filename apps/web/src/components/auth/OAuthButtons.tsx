"use client";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { config } from "@/lib/config";

type Props = { next?: string };

export function OAuthButtons({ next }: Props) {
  const handleGoogle = async () => {
    const client = supabaseBrowser();
    const redirectTo = `${config.app.url}/api/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`;
    await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
  };

  return (
    <div className="oauth-buttons">
      <button type="button" className="oauth-button oauth-button--google" onClick={handleGoogle}>
        Continue with Google
      </button>
    </div>
  );
}
