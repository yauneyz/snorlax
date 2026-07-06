"use client";
import { useEffect } from "react";
import { captureException } from "@/lib/sentry";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void captureException(error);
  }, [error]);

  return (
    <main className="error-page">
      <h1>Something went wrong</h1>
      <p>{error.message}</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
