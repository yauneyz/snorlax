"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Posts to /api/stripe/subscription/cancel; the page's own load never cancels anything. */
export function CancelSubscriptionButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/subscription/cancel", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Cancellation failed");
      // The page re-renders from the synced subscription row and shows the outcome.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setPending(false);
    }
  };

  return (
    <div className="manage-billing">
      <button type="button" className="manage-billing__button" onClick={onClick} disabled={pending}>
        {pending ? "Cancelling…" : "Cancel Pro"}
      </button>
      {error ? <p className="manage-billing__error">{error}</p> : null}
    </div>
  );
}
