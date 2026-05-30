import Link from "next/link";
import {
  User, Database, ChevronRight,
  Sparkles, ListFilter, Scale, LayoutGrid, Bell,
  Bot, Users, Info,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { logout } from "@/app/auth/actions";
import { PushToggle } from "@/components/settings/PushToggle";
import { AnalysisExplainer } from "@/components/settings/AnalysisExplainer";

interface NavLink {
  href: string;
  label: string;
  Icon: LucideIcon;
  badge?: string;
}

const NAV_GROUPS: { title: string; links: NavLink[] }[] = [
  {
    title: "Analyse & Tools",
    links: [
      { href: "/dashboard/search",   label: "NH Select",        Icon: Sparkles },
      { href: "/dashboard/screener", label: "Screener",         Icon: ListFilter, badge: "NEU" },
      { href: "/dashboard/compare",  label: "Aktienvergleich",  Icon: Scale },
      { href: "/dashboard/sectors",  label: "Sektor-Übersicht", Icon: LayoutGrid },
      { href: "/dashboard/alerts",   label: "Preis-Alerts",     Icon: Bell },
    ],
  },
  {
    title: "Hintergrund & Team",
    links: [
      { href: "/dashboard/agents", label: "KI-Agenten",         Icon: Bot },
      { href: "/dashboard/team",   label: "KI-Team",            Icon: Users },
      { href: "/dashboard/about",  label: "Über Next Horizon",  Icon: Info },
    ],
  },
];

function NavRow({ href, label, Icon, badge, last }: NavLink & { last: boolean }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3"
      style={last ? undefined : { borderBottom: "1px solid var(--card-border)" }}>
      <span
        className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
        style={{ background: "var(--card-border)" }}>
        <Icon size={16} style={{ color: "var(--primary)" }} />
      </span>
      <span className="text-sm text-white flex-1">{label}</span>
      {badge && (
        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
          style={{ background: "rgba(99,102,241,0.2)", color: "#818cf8" }}>
          {badge}
        </span>
      )}
      <ChevronRight size={16} style={{ color: "var(--muted)" }} />
    </Link>
  );
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Mehr</h2>

      {/* Account info */}
      <div
        className="rounded-2xl border p-4"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <div className="flex items-center gap-3">
          <span
            className="flex items-center justify-center w-10 h-10 rounded-full flex-shrink-0"
            style={{ background: "var(--card-border)" }}>
            <User size={18} style={{ color: "var(--primary)" }} />
          </span>
          <div className="min-w-0">
            <p className="text-white truncate">{user?.email}</p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Registriert: {user?.created_at ? new Date(user.created_at).toLocaleDateString("de-DE") : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* KI-Aktienanalyse erklärt */}
      <AnalysisExplainer />

      {/* Gruppierte Navigation */}
      {NAV_GROUPS.map(group => (
        <div key={group.title}>
          <p className="text-xs uppercase tracking-wide font-medium px-1 pb-2" style={{ color: "var(--muted)" }}>
            {group.title}
          </p>
          <div
            className="rounded-2xl border overflow-hidden"
            style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
            {group.links.map((link, i) => (
              <NavRow key={link.href} {...link} last={i === group.links.length - 1} />
            ))}
          </div>
        </div>
      ))}

      {/* Benachrichtigungen */}
      <PushToggle />

      {/* Datenquelle */}
      <div
        className="rounded-2xl border p-4 space-y-2 text-sm"
        style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
        <div className="flex items-center gap-2">
          <Database size={14} style={{ color: "var(--muted)" }} />
          <p className="text-xs uppercase tracking-wide font-medium" style={{ color: "var(--muted)" }}>
            Datenquelle
          </p>
        </div>
        <p style={{ color: "var(--muted)" }}>
          Kurse & Kennzahlen: Yahoo Finance via yfinance (inoffiziell). Wechselkurse:
          Yahoo Finance, abgesichert über den EZB-Referenzkurs. Alle Daten ohne Gewähr,
          Cache-TTL 6 Stunden.
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
        Next Horizon v0.1.0 · Nur zu Research-Zwecken
      </p>
    </div>
  );
}
