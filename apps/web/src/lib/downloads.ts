/**
 * The desktop installers the site offers, shared by /download, the post-download page and the
 * /api/desktop/download route. Pure (no config), so client components can import it.
 *
 * File names are the stable S3 aliases scripts/lib/release-hosting.mjs publishes under `app/`;
 * keep the two in sync.
 */
export type DownloadPlatform = "win" | "mac" | "linux";
export type LinuxFormat = "deb" | "rpm" | "pacman";

export type DownloadTarget = { platform: DownloadPlatform; format: LinuxFormat | null };

export const LINUX_FORMATS: Record<
  LinuxFormat,
  { file: string; label: string; distros: string; install: string[] }
> = {
  deb: {
    file: "Talysman.deb",
    label: ".deb",
    distros: "Ubuntu, Debian, Mint, Pop!_OS",
    install: ["sudo apt install ~/Downloads/Talysman.deb"],
  },
  rpm: {
    file: "Talysman.rpm",
    label: ".rpm",
    distros: "Fedora, RHEL, openSUSE",
    install: [
      "sudo dnf install ~/Downloads/Talysman.rpm      # Fedora / RHEL",
      "sudo zypper install ~/Downloads/Talysman.rpm   # openSUSE",
    ],
  },
  pacman: {
    file: "Talysman.pacman",
    label: "pacman",
    distros: "Arch, Manjaro, EndeavourOS",
    install: ["sudo pacman -U ~/Downloads/Talysman.pacman"],
  },
};

const PLATFORM_FILES: Record<Exclude<DownloadPlatform, "linux">, string> = {
  win: "Talysman-Setup.exe",
  mac: "Talysman.dmg",
};

export const PLATFORM_LABELS: Record<DownloadPlatform, string> = {
  win: "Windows",
  mac: "macOS",
  linux: "Linux",
};

function isPlatform(value: unknown): value is DownloadPlatform {
  return value === "win" || value === "mac" || value === "linux";
}

function isLinuxFormat(value: unknown): value is LinuxFormat {
  return value === "deb" || value === "rpm" || value === "pacman";
}

/**
 * Validates a requested installer. Linux without a format is the .deb, which is what every
 * link before rpm/pacman existed meant; a format on any other platform is ignored.
 */
export function parseDownloadTarget(platform: unknown, format: unknown): DownloadTarget | null {
  if (!isPlatform(platform)) return null;
  if (platform !== "linux") return { platform, format: null };
  if (format == null || format === "") return { platform, format: "deb" };
  return isLinuxFormat(format) ? { platform, format } : null;
}

export function installerFile(target: DownloadTarget): string {
  return target.platform === "linux"
    ? LINUX_FORMATS[target.format ?? "deb"].file
    : PLATFORM_FILES[target.platform];
}

function query(target: DownloadTarget, from: string | null): string {
  const params = new URLSearchParams({ platform: target.platform });
  if (target.format) params.set("format", target.format);
  if (from) params.set("from", from);
  return params.toString();
}

/** The post-download page: starts the download, records it, and shows install steps. */
export function startHref(target: DownloadTarget, from: string | null = null): string {
  return `/download/start?${query(target, from)}`;
}

/** The plain installer redirect. Untracked: the post-download page is what records downloads. */
export function directHref(target: DownloadTarget, from: string | null = null): string {
  return `/api/desktop/download?${query(target, from)}`;
}
