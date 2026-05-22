import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  // Vercel cron sends Authorization: Bearer <CRON_SECRET>
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  const { data: alerts } = await supabase
    .from("price_alerts")
    .select("*")
    .eq("triggered", false);

  if (!alerts?.length) return NextResponse.json({ checked: 0 });

  const symbols = [...new Set(alerts.map(a => a.symbol))];
  const priceMap: Record<string, number | null> = {};

  await Promise.all(
    symbols.map(async (sym) => {
      try {
        const res = await fetch(`${FINANCE_API_URL}/assets/${sym}`);
        if (res.ok) {
          const data = await res.json();
          priceMap[sym] = data.price ?? null;
        }
      } catch {
        priceMap[sym] = null;
      }
    })
  );

  const triggered: string[] = [];

  for (const alert of alerts) {
    const price = priceMap[alert.symbol];
    if (price == null) continue;

    const isTriggered =
      (alert.direction === "above" && price >= alert.target_price) ||
      (alert.direction === "below" && price <= alert.target_price);

    if (!isTriggered) continue;

    await supabase
      .from("price_alerts")
      .update({ triggered: true, triggered_at: new Date().toISOString() })
      .eq("id", alert.id);

    triggered.push(alert.id);

    // Send email if RESEND_API_KEY is configured
    if (process.env.RESEND_API_KEY && process.env.ALERT_FROM_EMAIL) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", alert.user_id)
        .single();

      if (profile?.email) {
        const dirLabel = alert.direction === "above" ? "überschritten" : "unterschritten";
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: process.env.ALERT_FROM_EMAIL,
            to: profile.email,
            subject: `Kurs-Alarm: ${alert.symbol} hat $${alert.target_price} ${dirLabel}`,
            html: `
              <h2>Kurs-Alarm ausgelöst</h2>
              <p><strong>${alert.symbol}</strong> (${alert.name}) handelt aktuell bei <strong>$${price.toFixed(2)}</strong>.</p>
              <p>Dein Zielpreis von <strong>$${alert.target_price}</strong> wurde ${dirLabel}.</p>
              <p><a href="https://${process.env.NEXT_PUBLIC_APP_URL ?? "nexthorizon-ai.com"}/dashboard/asset/${alert.symbol}">Zur Aktie →</a></p>
            `,
          }),
        }).catch(() => null);
      }
    }
  }

  return NextResponse.json({ checked: alerts.length, triggered: triggered.length });
}
