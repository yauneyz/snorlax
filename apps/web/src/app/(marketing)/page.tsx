import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/LandingPage";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  // Absolute so the root layout's "%s - Talysman" template doesn't repeat the brand name.
  title: {
    absolute: `${config.app.name} — Website & App Blocker You Can't Turn Off on Impulse`,
  },
  description: `${config.app.name} blocks distracting websites and desktop apps. Ending a focus session early requires a physical USB key you left in another room — paired from any USB drive you already own.`,
  alternates: { canonical: `${config.app.url}/` },
};

export default function Page() {
  return <LandingPage />;
}
