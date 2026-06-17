"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { forgotPasswordSchema } from "@/lib/zod/auth";
import { config } from "@/lib/config";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setStatus("sending");
    const client = supabaseBrowser();
    const { error: err } = await client.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${config.app.url}/reset-password`,
    });
    if (err) {
      setStatus("idle");
      setError(err.message);
      return;
    }
    setStatus("sent");
  };

  return (
    <form className="auth-form" onSubmit={onSubmit}>
      <h1>Reset password</h1>
      {status === "sent" ? (
        <p>Check your email for a reset link.</p>
      ) : (
        <>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <button type="submit" disabled={status === "sending"}>
            {status === "sending" ? "Sending…" : "Send reset link"}
          </button>
        </>
      )}
    </form>
  );
}
