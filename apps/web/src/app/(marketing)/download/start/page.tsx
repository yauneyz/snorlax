import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DownloadStarter } from "@/components/marketing/DownloadStarter";
import { config } from "@/lib/config";
import { downloadSource } from "@/lib/content/intent";
import {
  LINUX_FORMATS,
  PLATFORM_LABELS,
  installerFile,
  parseDownloadTarget,
  startHref,
  type DownloadTarget,
  type LinuxFormat,
} from "@/lib/downloads";

export const metadata: Metadata = {
  title: "Downloading",
  robots: { index: false, follow: false },
};

function first(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function InstallSteps({ target, fileName }: { target: DownloadTarget; fileName: string }) {
  if (target.platform === "win") {
    return (
      <ol className="download-start__steps">
        <li>
          Open <strong>{fileName}</strong> from your downloads.
        </li>
        <li>
          If Windows says <em>&ldquo;Windows protected your PC&rdquo;</em>, choose{" "}
          <strong>More info → Run anyway</strong>. The installer is signed (publisher: Zachary
          Yauney); the warning only means Windows hasn&rsquo;t seen many copies of this new app yet.
        </li>
        <li>
          Approve the administrator prompt. It installs the background service that keeps a
          session running even if you close the window or restart.
        </li>
        <li>{config.app.name} opens when setup finishes.</li>
      </ol>
    );
  }
  if (target.platform === "mac") {
    return (
      <ol className="download-start__steps">
        <li>
          Open <strong>{fileName}</strong> from your Downloads.
        </li>
        <li>
          Drag <strong>{config.app.name}</strong> into <strong>Applications</strong>.
        </li>
        <li>
          Open {config.app.name} from Applications. It runs natively on Apple Silicon and Intel.
        </li>
        <li>
          Enter your Mac password when asked. That installs the background service that enforces
          your sessions.
        </li>
      </ol>
    );
  }
  const format = LINUX_FORMATS[target.format ?? "deb"];
  return (
    <ol className="download-start__steps">
      <li>
        Install the package (adjust the path if you saved it somewhere else):
        <pre className="download-start__code">
          <code>{format.install.join("\n")}</code>
        </pre>
        Your package manager pulls in the dependencies (nftables, dnsmasq) and starts the
        background service.
      </li>
      <li>
        Open {config.app.name} from your app menu, or run <code>talysman</code>.
      </li>
    </ol>
  );
}

export default async function DownloadStartPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string | string[]; format?: string | string[]; from?: string | string[] }>;
}) {
  const params = await searchParams;
  const target = parseDownloadTarget(first(params.platform), first(params.format));
  if (!target) redirect("/download");
  const from = downloadSource(first(params.from));
  const fileName = installerFile(target);
  const otherLinuxFormats = (Object.keys(LINUX_FORMATS) as LinuxFormat[]).filter(
    (format) => format !== target.format,
  );

  return (
    <section className="download download-start">
      <header className="download__header">
        <p className="section__eyebrow">{PLATFORM_LABELS[target.platform]} download</p>
        <h1 className="download__headline">Almost there.</h1>
        <DownloadStarter target={target} from={from} fileName={fileName} />
      </header>

      <div className="download__group">
        <div className="download__group-head">
          <span className="download__step">INSTALL</span>
          <h2>Install {config.app.name}</h2>
        </div>
        <InstallSteps target={target} fileName={fileName} />
        {target.platform === "linux" ? (
          <p className="download-start__alt">
            Wrong package for your distro? Get the{" "}
            {otherLinuxFormats.map((format, i) => (
              <span key={format}>
                {i > 0 ? " or the " : ""}
                <Link href={startHref({ platform: "linux", format }, from)}>
                  {LINUX_FORMATS[format].label}
                </Link>{" "}
                ({LINUX_FORMATS[format].distros})
              </span>
            ))}
            .
          </p>
        ) : null}
      </div>

      <aside className="download__next">
        <div>
          <span className="download__step">NEXT</span>
          <h2>Then add the browser extension.</h2>
          <p>
            The first time {config.app.name} opens, it brings you back to this browser to add the
            extension, which handles site blocking inside the browser. Nothing else to do here.
          </p>
        </div>
        <Link href="/download" className="landing__cta landing__cta--secondary">
          All downloads
        </Link>
      </aside>
    </section>
  );
}
