"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/auth/actions";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Watchlist", icon: "📊" },
  { href: "/dashboard/portfolio", label: "Portfolio", icon: "💼" },
  { href: "/dashboard/alerts", label: "Alarme", icon: "🔔" },
  { href: "/dashboard/search", label: "Suche", icon: "🔍" },
  { href: "/dashboard/settings", label: "Einstellungen", icon: "⚙️" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 border-t z-50 flex items-center"
      style={{
        background: "var(--card)",
        borderColor: "var(--card-border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}>
      <div className="flex-1 flex">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-opacity"
              style={{ opacity: active ? 1 : 0.5 }}>
              <span className="text-xl">{item.icon}</span>
              <span
                className="text-xs font-medium"
                style={{ color: active ? "var(--primary)" : "var(--muted)" }}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>

      <form action={logout} className="flex-shrink-0 pr-2">
        <button
          type="submit"
          className="flex flex-col items-center justify-center py-2 px-3 gap-0.5 opacity-50">
          <span className="text-xl">🚪</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Logout
          </span>
        </button>
      </form>
    </nav>
  );
}
