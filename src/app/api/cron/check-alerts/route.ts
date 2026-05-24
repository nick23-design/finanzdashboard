import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import webPush from "web-push";

const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:8000";

if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:admin@nexthorizon-ai.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: alerts } = await supabase
    .from("price_alerts")
    .select("*")
    .eq("triggered", false);

  if (!alerts?.length) return NextResponse.json({ checked: 0 });

  // Fetch current prices for all unique symbols
  const symbols = [...new Set(alerts.map(a => a.symbol))];
  const priceMap: Record<string, number | null> = {};

  await Promise.all(
    symbols.map(async (sym) => {
      try {
        const res = await fetch(`${FINANCE_API_URL}/assets/${sym}`);
        if (res.ok) {
          const d = await res.json();
          priceMap[sym] = d.price ?? null;
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

    // Mark triggered
    await supabase
      .from("price_alerts")
      .update({ triggered: true, triggered_at: new Date().toISOString() })
      .eq("id", alert.id);

    triggered.push(alert.id);

    const dirLabel = alert.direction === "above" ? "überschritten" : "unterschritten";
    const notifTitle = `Kurs-Alarm: ${alert.symbol}`;
    const notifBody = `${alert.symbol} hat $${alert.target_price.toFixed(2)} ${dirLabel} — Aktuell: $${price.toFixed(2)}`;
    const notifUrl = `/dashboard/asset/${alert.symbol}`;

    // Send Web Push notification
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: subs } = await (supabase as any)
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", alert.user_id);

    for (const sub of (subs ?? []) as { endpoint: string; p256dh: string; auth: string }[]) {
      await webPush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title: notifTitle, body: notifBody, url: notifUrl, tag: "price-alert" }),
      ).catch(() => null); // ignore expired/invalid subscriptions
    }

    // Send email via Resend (optional)
    if (process.env.RESEND_API_KEY && process.env.ALERT_FROM_EMAIL) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", alert.user_id)
        .single();

      if (profile?.email) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: process.env.ALERT_FROM_EMAIL,
            to: profile.email,
            subject: notifTitle,
            html: `
              <h2>Kurs-Alarm ausgelöst</h2>
              <p><strong>${alert.symbol}</strong> handelt aktuell bei <strong>$${price.toFixed(2)}</strong>.</p>
              <p>Dein Zielpreis von <strong>$${alert.target_price}</strong> wurde ${dirLabel}.</p>
              <p><a href="https://${process.env.NEXT_PUBLIC_APP_URL ?? "nexthorizon-ai.com"}${notifUrl}">Zur Aktie →</a></p>
            `,
          }),
        }).catch(() => null);
      }
    }
  }

  return NextResponse.json({ checked: alerts.length, triggered: triggered.length });
}
