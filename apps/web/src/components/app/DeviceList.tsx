"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PRO_DEVICE_STALE_AFTER_DAYS } from "@talysman/product";

export type DeviceListItem = {
  deviceId: string;
  name: string | null;
  platform: string | null;
  lastSeenAt: string;
};

const PLATFORM_LABELS: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

/** The computers holding this account's Pro slots, each removable to free its slot. */
export function DeviceList({ devices, limit }: { devices: DeviceListItem[]; limit: number }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (deviceId: string) => {
    setPending(deviceId);
    setError(null);
    try {
      const res = await fetch("/api/account/devices", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not remove the device");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="account__devices">
      <h2 className="account__devices-title">
        Computers using Pro · {devices.length} of {limit}
      </h2>
      <p className="account__devices-hint">
        Pro works on up to {limit} computers at once. Remove one you no longer use to free its
        spot. Computers that haven&apos;t checked in for {PRO_DEVICE_STALE_AFTER_DAYS} days drop
        off by themselves.
      </p>
      {devices.length === 0 ? (
        <p className="account__devices-empty">
          No computers yet. Sign in to the desktop app and it will show up here.
        </p>
      ) : (
        <ul className="account__devices-list">
          {devices.map((device) => (
            <li key={device.deviceId} className="account__device">
              <div>
                <p className="account__device-name">{device.name ?? "Unnamed computer"}</p>
                <p className="account__device-meta">
                  {device.platform ? `${PLATFORM_LABELS[device.platform] ?? device.platform} · ` : ""}
                  Last used {new Date(device.lastSeenAt).toLocaleDateString()}
                </p>
              </div>
              <button
                type="button"
                className="account__device-remove"
                onClick={() => remove(device.deviceId)}
                disabled={pending !== null}
              >
                {pending === device.deviceId ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="account__devices-error">{error}</p> : null}
    </section>
  );
}
