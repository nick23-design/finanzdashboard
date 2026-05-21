"use client";

import { useActionState, useTransition } from "react";
import Link from "next/link";
import { login, signup } from "@/app/auth/actions";
import { Disclaimer } from "@/components/ui/Disclaimer";

interface AuthFormProps {
  mode: "login" | "signup";
}

const initialState = { error: undefined as string | undefined, success: undefined as string | undefined };

export function AuthForm({ mode }: AuthFormProps) {
  const action = mode === "login" ? login : signup;
  const [state, formAction] = useActionState(action, initialState);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => {
      formAction(formData);
    });
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-4"
      style={{ background: "var(--background)" }}>
      <div className="w-full max-w-sm">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white">Finanzdashboard</h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
            Regelbasierte Aktienanalyse
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-6 border"
          style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
          <h2 className="text-lg font-semibold text-white mb-6">
            {mode === "login" ? "Anmelden" : "Registrieren"}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1"
                style={{ color: "var(--muted)" }}>
                E-Mail
              </label>
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                className="w-full rounded-xl px-4 py-3 text-white text-sm border outline-none
                  focus:ring-2 transition-all"
                style={{
                  background: "var(--background)",
                  borderColor: "var(--card-border)",
                }}
                placeholder="name@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1"
                style={{ color: "var(--muted)" }}>
                Passwort
              </label>
              <input
                name="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                minLength={8}
                className="w-full rounded-xl px-4 py-3 text-white text-sm border outline-none
                  focus:ring-2 transition-all"
                style={{
                  background: "var(--background)",
                  borderColor: "var(--card-border)",
                }}
                placeholder="••••••••"
              />
            </div>

            {state?.error && (
              <p className="text-sm rounded-lg px-3 py-2"
                style={{ color: "var(--danger)", background: "#450a0a" }}>
                {state.error}
              </p>
            )}

            {state?.success && (
              <p className="text-sm rounded-lg px-3 py-2"
                style={{ color: "var(--success)", background: "#052e16" }}>
                {state.success}
              </p>
            )}

            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-xl py-3 font-semibold text-white transition-all
                disabled:opacity-50"
              style={{ background: isPending ? "var(--muted)" : "var(--primary)" }}>
              {isPending
                ? "Laden…"
                : mode === "login"
                ? "Anmelden"
                : "Konto erstellen"}
            </button>
          </form>

          <div className="mt-4 text-center text-sm" style={{ color: "var(--muted)" }}>
            {mode === "login" ? (
              <>
                Noch kein Konto?{" "}
                <Link href="/auth/signup"
                  className="underline" style={{ color: "var(--primary)" }}>
                  Registrieren
                </Link>
              </>
            ) : (
              <>
                Bereits registriert?{" "}
                <Link href="/auth/login"
                  className="underline" style={{ color: "var(--primary)" }}>
                  Anmelden
                </Link>
              </>
            )}
          </div>
        </div>

        <Disclaimer className="mt-6" />
      </div>
    </div>
  );
}
