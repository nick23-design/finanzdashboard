import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { logout } from "@/app/auth/actions";
import { PushToggle } from "@/components/settings/PushToggle";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Einstellungen</h2>

      {/* Account info */}
      <div
        className="rounded-2xl border p-4 space-y-2"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <p className="text-xs uppercase tracking-wide font-medium" style={{ color: "var(--muted)" }}>
          Konto
        </p>
        <p className="text-white">{user?.email}</p>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Registriert: {user?.created_at ? new Date(user.created_at).toLocaleDateString("de-DE") : "—"}
        </p>
      </div>

      {/* Info */}
      <div
        className="rounded-2xl border p-4 space-y-2 text-sm"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <p className="text-xs uppercase tracking-wide font-medium" style={{ color: "var(--muted)" }}>
          Datenquelle
        </p>
        <p style={{ color: "var(--muted)" }}>
          Yahoo Finance via yfinance (inoffiziell). Daten ohne Gewähr.
          Cache-TTL: 6 Stunden.
        </p>
      </div>

      {/* Navigation */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <p className="text-xs uppercase tracking-wide font-medium px-4 pt-4 pb-2" style={{ color: "var(--muted)" }}>
          Weitere Seiten
        </p>
        <Link
          href="/dashboard/team"
          className="flex items-center justify-between px-4 py-3 border-t"
          style={{ borderColor: "var(--card-border)" }}>
          <span className="text-sm text-white">KI-Team</span>
          <span style={{ color: "var(--muted)" }}>›</span>
        </Link>
        <Link
          href="/dashboard/alerts"
          className="flex items-center justify-between px-4 py-3 border-t"
          style={{ borderColor: "var(--card-border)" }}>
          <span className="text-sm text-white">Preis-Alerts</span>
          <span style={{ color: "var(--muted)" }}>›</span>
        </Link>
      </div>

      <PushToggle />

      <Disclaimer />

      {/* Logout */}
      <form action={logout}>
        <button
          type="submit"
          className="w-full rounded-xl py-3 font-semibold text-white"
          style={{ background: "var(--danger)" }}>
          Abmelden
        </button>
      </form>

      <p className="text-xs text-center" style={{ color: "var(--muted)" }}>
        Next Horizon v0.1.0 · Nur zu Research-Zwecken
      </p>
    </div>
  );
}
