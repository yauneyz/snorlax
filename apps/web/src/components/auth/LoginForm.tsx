"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { loginSchema } from "@/lib/zod/auth";
import { safeInternalPath } from "@/lib/auth/redirects";

type Props = { next?: string; initialError?: string };

export function LoginForm({ next = "/app", initialError }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setPending(true);
    const client = supabaseBrowser();
    const { error: err } = await client.auth.signInWithPassword(parsed.data);
    setPending(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.push(safeInternalPath(next));
    router.refresh();
  };

  return (
    <form className="auth-form" onSubmit={onSubmit}>
      <h1>Log in</h1>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
      </label>
      {error ? <p className="auth-error">{error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Log in"}
      </button>
      <div className="auth-links">
        <Link href="/forgot-password">Forgot password?</Link>
        <Link href="/signup">Create account</Link>
      </div>
    </form>
  );
}
