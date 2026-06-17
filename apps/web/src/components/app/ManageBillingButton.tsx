"use client";
import { useState } from "react";

export function ManageBillingButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Portal failed");
      const { url } = (await res.json()) as { url: string };
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setPending(false);
    }
  };

  return (
    <div className="manage-billing">
      <button type="button" className="manage-billing__button" onClick={onClick} disabled={pending}>
        {pending ? "Opening portal…" : "Manage billing"}
      </button>
      {error ? <p className="manage-billing__error">{error}</p> : null}
    </div>
  );
}
