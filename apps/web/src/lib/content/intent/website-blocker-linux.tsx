import Link from "next/link";
import { FREE_BLOCKED_SITE_LIMIT } from "@talysman/product";
import { config } from "@/lib/config";
import type { IntentPage } from "./types";

/**
 * Linux users read the mechanism before the pitch, so the page names the moving parts — systemd,
 * nftables, dnsmasq, the pre-removal guard — and is explicit about where that guard doesn't reach
 * (pacman ignores a failing pre_remove hook). Also concedes that FocusMe lists Linux, and notes
 * Cold Turkey doesn't.
 */
export const websiteBlockerLinux: IntentPage = {
  slug: "website-blocker-linux",
  group: "use-cases",
  summary: "A Linux blocker run by systemd and nftables, ended early only with a USB key.",
  lastReviewed: "2026-10-15",
  showLastReviewed: true,
  intent: "website blocker for linux that is difficult to bypass",
  eyebrow: "Website blocker for Linux",
  title: "Website blocker for Linux: strict focus with a USB key",
  metaTitle: "Website Blocker for Linux: Strict Focus with a USB Key",
  metaDescription:
    "A Linux distraction blocker for Ubuntu, Debian, Fedora and Arch that requires your paired USB key to end protected sessions early.",
  lede: (
    <>
      On Linux you know exactly how to kill a blocker. So the question is what it costs you to do it
      in the middle of the afternoon.
    </>
  ),
  answer: (
    <>
      <p>
        {config.app.name} is a website and app blocker for Ubuntu, Debian, Fedora, openSUSE and
        Arch that is difficult to bypass on impulse: it runs as a root systemd service that restarts
        if killed, blocks with nftables and dnsmasq below the browser, and refuses{" "}
        <code>apt remove</code> or <code>dnf remove</code> during a focus session unless your paired
        USB key is plugged in. Ending a session early needs the key.
      </p>
      <p>
        Most strict desktop blockers don&apos;t run on Linux at all — Cold Turkey is Windows and
        macOS only. FocusMe does list Linux.
      </p>
    </>
  ),
  sections: [
    {
      kind: "demo",
      title: "Try to kill it",
      beats: [
        { label: "kill", body: "sudo pkill talysman-svc. A second later systemctl status says active (running) again: the unit has Restart=always." },
        { label: "apt remove", body: "The pre-removal hook asks the service first. Focus is on and no key is present, so dpkg aborts the removal." },
        { label: "Turn off", body: "The off switch checks for your paired USB key. It's in the kitchen." },
        { label: "Root", body: "You can still take it apart on purpose — it's your machine. What's gone is the ten-second version." },
      ],
      media: {
        label: "Linux: kill, apt remove, refusal",
        note: "Terminal: pkill → service back via systemd → apt remove aborted by the prerm hook → Talysman refusal → key in another room.",
        ratio: "16 / 9",
        kind: "video",
      },
    },
    {
      kind: "table",
      title: "What happens when you try to get out on Linux",
      columns: ["You try", "What happens"],
      rows: [
        ["Close the app", "Nothing. The service does the blocking."],
        ["kill the service process", "systemd restarts it (Restart=always)."],
        ["systemctl stop as your user", "Needs root — an admin password, typed on purpose."],
        ["Reboot", "The service is enabled at boot and the session comes back."],
        ["apt remove or dnf remove talysman", "The pre-removal hook checks the service and aborts during focus without a key."],
        ["pacman -R talysman", "Goes through. pacman runs the same hook but removes the package even when it refuses."],
        ["Edit /etc/hosts or switch browsers", "Blocking is nftables and DNS rules, not a hosts file or a browser extension alone."],
        ["Click End session", "The service checks for your paired USB key. Not there, no unlock."],
      ],
    },
    {
      kind: "steps",
      title: "Set it up",
      steps: [
        {
          title: "Install the package",
          body: (
            <>
              <Link href="/download?from=website-blocker-linux">Download the .deb, .rpm or pacman package</Link>{" "}
              (x86-64) and install it with apt, dnf, zypper or pacman. It sets up and starts the
              systemd service.
            </>
          ),
        },
        {
          title: "Add the browser extension",
          body: "Chrome/Chromium or Firefox, for site rules and in-browser block pages.",
        },
        {
          title: "Pair a USB drive and start a session",
          body: "Any drive. It's identified by the serial or volume ID it already reports — normally nothing is written to it.",
        },
      ],
    },
    {
      kind: "honesty",
      title: "Limits, plainly",
      body: (
        <>
          <p>
            You have root. With root you can stop anything, this included — boot another kernel,
            flush nftables while the service restarts, purge the package from a live USB. Nothing on
            a machine you administer is unbreakable. What {config.app.name} removes is the
            ten-second version: the one you&apos;d type without thinking.
          </p>
          <p>
            Packaged for x86-64 as a .deb (Ubuntu, Debian, Mint, Pop!_OS), .rpm (Fedora, RHEL,
            openSUSE) and pacman package (Arch, Manjaro, EndeavourOS). On Arch the removal guard
            doesn&apos;t hold: pacman removes a package even when its hook refuses, so{" "}
            <code>pacman -R</code> ends a session. Everything else above applies.
          </p>
        </>
      ),
    },
    {
      kind: "faq",
      items: [
        {
          q: "Which distributions are supported?",
          a: (
            <p>
              Ubuntu, Debian and their derivatives (.deb), Fedora, RHEL and openSUSE (.rpm), and
              Arch, Manjaro and EndeavourOS (pacman), all x86-64.
            </p>
          ),
        },
        {
          q: "Is it free on Linux?",
          a: (
            <p>
              Yes — {FREE_BLOCKED_SITE_LIMIT} sites, unlimited manual sessions and the key
              requirement. App blocking and schedules are <Link href="/pricing">Pro</Link>.
            </p>
          ),
        },
        {
          q: "Does it survive a reboot?",
          a: <p>Yes. The service is enabled at boot and restores the session state.</p>,
        },
      ],
    },
  ],
  cta: {
    heading: "Try it on your distro",
    body: "Install the package, pair a drive, and try to kill it.",
  },
  graphic: {
    kind: "ladder",
    title: "Getting out on Linux: every route",
    caption: "What happens on Linux when you close Talysman, kill the service, use systemctl, reboot, uninstall it with apt, dnf or pacman, edit hosts or click End session without the key.",
    fromTable: "What happens when you try to get out on Linux",
    rows: {
      "Close the app": "blocked",
      "kill the service process": "blocked",
      "systemctl stop as your user": "cost",
      "Reboot": "blocked",
      "apt remove or dnf remove talysman": "blocked",
      "pacman -R talysman": "open",
      "Edit /etc/hosts or switch browsers": "blocked",
      "Click End session": "blocked",
    },
  },
  related: ["focus-app-developers", "website-blocker-windows", "website-blocker-you-cant-turn-off", "focusme-alternative"],
};
