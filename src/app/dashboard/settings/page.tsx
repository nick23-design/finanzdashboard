import { createClient } from "@/lib/supabase/server";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { logout } from "@/app/auth/actions";

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
        Finanzdashboard v0.1.0 · Nur zu Research-Zwecken
      </p>
    </div>
  );
}
