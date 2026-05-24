"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

type Status = "loading" | "unsupported" | "denied" | "subscribed" | "unsubscribed";

export function PushToggle() {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    navigator.serviceWorker.ready.then(async reg => {
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub ? "subscribed" : "unsubscribed");
    });
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setStatus("denied"); return; }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
        ),
      });

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });

      setStatus("subscribed");
    } catch {
      // permission denied or error
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("unsubscribed");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") return null;

  return (
    <div
      className="rounded-2xl border p-4 space-y-3"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <p className="text-xs uppercase tracking-wide font-medium" style={{ color: "var(--muted)" }}>
        Push-Benachrichtigungen
      </p>

      {status === "unsupported" && (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Dein Browser unterstützt keine Push-Nachrichten.
        </p>
      )}

      {status === "denied" && (
        <p className="text-sm" style={{ color: "#ef4444" }}>
          Benachrichtigungen blockiert — bitte in den Browser-Einstellungen erlauben.
        </p>
      )}

      {(status === "subscribed" || status === "unsubscribed") && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white">
                {status === "subscribed" ? "Aktiviert" : "Deaktiviert"}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                {status === "subscribed"
                  ? "Du erhältst Kurs-Alarme auf diesem Gerät"
                  : "Keine Push-Nachrichten auf diesem Gerät"}
              </p>
            </div>
            <div
              className="w-11 h-6 rounded-full flex items-center px-0.5 cursor-pointer transition-colors"
              style={{
                background: status === "subscribed" ? "var(--primary)" : "var(--card-border)",
              }}
              onClick={status === "subscribed" ? disable : enable}>
              <div
                className="w-5 h-5 rounded-full bg-white transition-transform"
                style={{
                  transform: status === "subscribed" ? "translateX(20px)" : "translateX(0)",
                }}
              />
            </div>
          </div>

          {busy && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>Bitte warten…</p>
          )}

          {status === "unsubscribed" && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              iOS: App muss zum Home-Bildschirm hinzugefügt werden.
            </p>
          )}
        </>
      )}
    </div>
  );
}
