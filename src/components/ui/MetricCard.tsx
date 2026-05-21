interface MetricCardProps {
  label: string;
  value: string | number | null;
  unit?: string;
  hint?: string;
  highlight?: "good" | "bad" | "neutral";
}

const HIGHLIGHT_COLORS = {
  good: "var(--success)",
  bad: "var(--danger)",
  neutral: "var(--foreground)",
};

export function MetricCard({ label, value, unit, hint, highlight = "neutral" }: MetricCardProps) {
  const displayValue = value === null || value === undefined ? "—" : value;
  const color = HIGHLIGHT_COLORS[highlight];

  return (
    <div
      className="rounded-xl border p-3 flex flex-col gap-1"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <span className="text-xs uppercase tracking-wide font-medium"
        style={{ color: "var(--muted)" }}>
        {label}
      </span>
      <span className="text-xl font-bold" style={{ color }}>
        {displayValue}
        {unit && value !== null && (
          <span className="text-sm font-normal ml-0.5" style={{ color: "var(--muted)" }}>
            {unit}
          </span>
        )}
      </span>
      {hint && (
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {hint}
        </span>
      )}
    </div>
  );
}
