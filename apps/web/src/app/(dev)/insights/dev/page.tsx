import type { Metadata } from "next";
import { InsightsDashboard } from "@/components/insights/InsightsDashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Insights (DEV)" };

export default function DevInsightsPage() {
  return <InsightsDashboard target="dev" />;
}
