import { createClient } from "@/lib/supabase/server";
import { WatchlistView } from "@/components/dashboard/WatchlistView";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: items } = await supabase
    .from("watchlist_items")
    .select("*")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false });

  return <WatchlistView initialItems={items ?? []} />;
}
