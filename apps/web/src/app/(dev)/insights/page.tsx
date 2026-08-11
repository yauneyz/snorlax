import type { Metadata } from "next";
import { InsightsDashboard } from "@/components/insights/InsightsDashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Insights (PROD)" };

export default function InsightsPage() {
  return <InsightsDashboard target="prod" />;
}
