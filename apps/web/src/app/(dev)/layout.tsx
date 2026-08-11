import { notFound } from "next/navigation";
import { config } from "@/lib/config";

export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  if (!config.insights.enabled) notFound();
  return children;
}
