import { Header } from "@/components/marketing/Header";
import { Footer } from "@/components/marketing/Footer";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing-shell">
      <Header />
      <main className="marketing-main">{children}</main>
      <Footer />
    </div>
  );
}
