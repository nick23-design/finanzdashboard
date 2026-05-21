"use client";

interface ScoreBarProps {
  label: string;
  score: number;
  max?: number;
}

function getBarColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#2dd4bf";
  if (score >= 40) return "#94a3b8";
  if (score >= 20) return "#fb923c";
  return "#ef4444";
}

export function ScoreBar({ label, score, max = 100 }: ScoreBarProps) {
  const pct = Math.min(100, Math.max(0, (score / max) * 100));
  const color = getBarColor(score);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-sm">
        <span style={{ color: "var(--muted)" }}>{label}</span>
        <span className="font-semibold" style={{ color }}>
          {score}
        </span>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: "var(--card-border)" }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}
