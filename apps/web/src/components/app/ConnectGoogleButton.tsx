"use client";

export function ConnectGoogleButton({ label = "Connect Google Search Console" }: { label?: string }) {
  return (
    <div className="connect-google">
      <button
        type="button"
        className="connect-google__button"
        onClick={() => {
          window.location.assign("/api/connections/google/start");
        }}
      >
        {label}
      </button>
      <p className="connect-google__note">
        We&apos;ll request read-only access to your Search Console data.
      </p>
    </div>
  );
}
