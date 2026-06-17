"use client";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <main className="error-page error-page--global">
          <h1>Unexpected error</h1>
          <p>{error.message}</p>
        </main>
      </body>
    </html>
  );
}
