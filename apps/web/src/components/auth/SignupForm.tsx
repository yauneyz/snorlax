"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { signupSchema } from "@/lib/zod/auth";
import { safeInternalPath } from "@/lib/auth/redirects";

type Props = { next?: string };

export function SignupForm({ next = "/app" }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = signupSchema.safeParse({ email, password, fullName: fullName || undefined });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setPending(true);
    const client = supabaseBrowser();
    const { error: err } = await client.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { full_name: parsed.data.fullName ?? null },
      },
    });
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
      <h1>Create account</h1>
      <label>
        Full name
        <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
      </label>
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
          autoComplete="new-password"
          minLength={8}
        />
      </label>
      {error ? <p className="auth-error">{error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Sign up"}
      </button>
      <div className="auth-links">
        <Link href={next === "/app" ? "/login" : `/login?next=${encodeURIComponent(next)}`}>
          Already have an account?
        </Link>
      </div>
    </form>
  );
}
