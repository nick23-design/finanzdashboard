"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error ? error.message : "Unbekannter Fehler";
    return { hasError: true, message };
  }

  override render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div
            className="rounded-2xl border p-6 text-center my-4"
            style={{ background: "var(--card)", borderColor: "#7f1d1d" }}>
            <p className="text-2xl mb-2">⚠️</p>
            <p className="font-semibold text-white mb-1">
              Hier ist etwas schiefgelaufen
            </p>
            <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
              {this.state.message}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, message: "" })}
              className="rounded-xl px-4 py-2 text-sm font-medium text-white"
              style={{ background: "var(--primary)" }}>
              Erneut versuchen
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
