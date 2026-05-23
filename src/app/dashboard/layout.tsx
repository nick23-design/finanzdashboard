import Image from "next/image";
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
        <div className="flex items-center">
          <Image src="/logo-nh.png" alt="Next Horizon" width={120} height={36} className="h-9 w-auto object-contain" />
        </div>
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
