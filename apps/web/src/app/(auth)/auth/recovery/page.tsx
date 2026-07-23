import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Confirm password reset",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{
  token_hash?: string;
  error?: string;
}>;

export default async function RecoveryConfirmationPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const tokenHash = typeof params.token_hash === "string" ? params.token_hash : "";
  const failed = params.error === "invalid_or_expired";

  return (
    <form className="auth-form" action="/api/auth/recovery" method="post">
      <h1>Reset your password</h1>
      {failed ? (
        <>
          <p className="auth-error">
            This reset link is invalid or has expired. Request a new link to try again.
          </p>
          <div className="auth-links">
            <Link href="/forgot-password">Request a new reset link</Link>
          </div>
        </>
      ) : tokenHash ? (
        <>
          <p>
            Continue to verify this one-time link and choose a new password. The link is not used
            until you press the button.
          </p>
          <input type="hidden" name="token_hash" value={tokenHash} />
          <button type="submit">Continue</button>
        </>
      ) : (
        <>
          <p className="auth-error">This password-reset link is incomplete.</p>
          <div className="auth-links">
            <Link href="/forgot-password">Request a new reset link</Link>
          </div>
        </>
      )}
    </form>
  );
}
