import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tickerSchema } from "@/lib/validation";
import { AssetDetailView } from "@/components/asset/AssetDetailView";

interface PageProps {
  params: Promise<{ symbol: string }>;
}

export default async function AssetPage({ params }: PageProps) {
  const { symbol: rawSymbol } = await params;
  const parsed = tickerSchema.safeParse(rawSymbol);
  if (!parsed.success) redirect("/dashboard");

  const symbol = parsed.data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  return <AssetDetailView symbol={symbol} />;
}

export async function generateMetadata({ params }: PageProps) {
  const { symbol } = await params;
  return { title: `${symbol.toUpperCase()} – Next Horizon` };
}
