/**
 * The browser's analytics ingest path. Same handler as /api/analytics/track, under a name that
 * content blockers' generic `/analytics/` and `/track` rules don't match: on the old path most
 * page views from blocker users never arrived, while their server-recorded downloads did, so
 * the funnel showed downloads from people who had apparently never visited.
 *
 * /api/analytics/track stays for the desktop app (installed versions post there, and the Linux
 * uninstall hook hardcodes it); native clients aren't subject to content blockers.
 */
export const runtime = "nodejs";

export { POST } from "@/app/api/analytics/track/route";
