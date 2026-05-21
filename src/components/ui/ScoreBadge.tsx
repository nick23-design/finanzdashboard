import type { SignalType } from "@/types/finance";

const SIGNAL_STYLES: Record<SignalType, { bg: string; text: string; label: string }> = {
  Bullish:           { bg: "#052e16", text: "#4ade80", label: "Bullish" },
  "Slightly Bullish":{ bg: "#042f2e", text: "#2dd4bf", label: "Leicht Bullish" },
  Neutral:           { bg: "#1e293b", text: "#94a3b8", label: "Neutral" },
  Caution:           { bg: "#431407", text: "#fb923c", label: "Vorsicht" },
  "High Risk":       { bg: "#450a0a", text: "#f87171", label: "Hohes Risiko" },
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
