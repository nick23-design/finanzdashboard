import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/layout/BottomNav";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  return (
    <div className="flex flex-col min-h-dvh">
      {/* Header */}
      <header
        className="sticky top-0 z-40 px-4 py-3 flex items-center justify-between border-b"
        style={{
          background: "var(--card)",
          borderColor: "var(--card-border)",
        }}>
        <h1 className="font-bold text-white text-base">📈 Finanzdashboard</h1>
        <Disclaimer compact />
      </header>

      {/* Main content with bottom padding for nav */}
      <main className="flex-1 px-4 py-4 pb-24 max-w-2xl mx-auto w-full">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>

      <BottomNav />
    </div>
  );
}
