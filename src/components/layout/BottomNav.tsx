"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Star, Target, Newspaper, Bot, Settings2 } from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard",          label: "Watchlist",  Icon: Star },
  { href: "/dashboard/search",   label: "NH Select",  Icon: Target },
  { href: "/dashboard/news",     label: "News",       Icon: Newspaper },
  { href: "/dashboard/team",     label: "KI-Team",    Icon: Bot },
  { href: "/dashboard/settings", label: "Mehr",       Icon: Settings2 },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 border-t z-50"
      style={{
        background: "var(--card)",
        borderColor: "var(--card-border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}>
      <div className="flex items-center">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-all"
              style={{ opacity: active ? 1 : 0.45 }}>
              <Icon
                size={20}
                style={{ color: active ? "var(--primary)" : "var(--muted)" }}
                strokeWidth={active ? 2.5 : 1.8}
              />
              <span
                className="text-[10px] font-medium"
                style={{ color: active ? "var(--primary)" : "var(--muted)" }}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
