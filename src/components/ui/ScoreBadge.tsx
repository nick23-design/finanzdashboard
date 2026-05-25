import type { SignalType } from "@/types/finance";

const SIGNAL_STYLES: Record<SignalType, { bg: string; text: string; label: string }> = {
  Bullish:           { bg: "rgba(34,197,94,0.18)",  text: "#4ade80", label: "Bullish" },
  "Slightly Bullish":{ bg: "rgba(34,197,94,0.10)",  text: "#86efac", label: "Leicht Bullish" },
  Neutral:           { bg: "rgba(148,163,184,0.15)", text: "#94a3b8", label: "Neutral" },
  Caution:           { bg: "rgba(251,146,60,0.18)",  text: "#fb923c", label: "Vorsicht" },
  "High Risk":       { bg: "rgba(239,68,68,0.18)",   text: "#f87171", label: "Hohes Risiko" },
};

interface ScoreBadgeProps {
  signal: SignalType;
  score?: number;
  size?: "sm" | "md" | "lg";
}

export function ScoreBadge({ signal, score, size = "md" }: ScoreBadgeProps) {
  const style = SIGNAL_STYLES[signal];
  const sizeClasses = {
    sm: "text-xs px-2 py-0.5",
    md: "text-sm px-3 py-1",
    lg: "text-base px-4 py-2 font-semibold",
  }[size];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${sizeClasses}`}
      style={{ background: style.bg, color: style.text }}>
      {score !== undefined && <span className="font-bold">{score}</span>}
      <span>{style.label}</span>
    </span>
  );
}
