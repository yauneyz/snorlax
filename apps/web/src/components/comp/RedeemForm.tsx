"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = { initialCode?: string };

/** Posts a complimentary-access code to /api/comp/redeem and reports the outcome. */
export function RedeemForm({ initialCode = "" }: Props) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setResult(null);
    try {
      const res = await fetch("/api/comp/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => null)) as {
        outcome?: string;
        message?: string;
        error?: string;
      } | null;
      const granted = data?.outcome === "ok" || data?.outcome === "already_comped";
      setResult({
        ok: granted,
        message: data?.message ?? data?.error ?? "Could not redeem that code.",
      });
      // Entitlement changed — re-render the server components that gate on it.
      if (granted) router.refresh();
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={onSubmit}>
      <h1>Redeem a code</h1>
      <label>
        Code
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="TLY-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </label>
      {result ? (
        <p className={result.ok ? "auth-notice" : "auth-error"}>{result.message}</p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "Redeeming…" : "Redeem"}
      </button>
    </form>
  );
}
