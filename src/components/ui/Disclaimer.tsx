interface DisclaimerProps {
  className?: string;
  compact?: boolean;
}

export function Disclaimer({ className = "", compact = false }: DisclaimerProps) {
  if (compact) {
    return (
      <p className={`text-xs text-center ${className}`} style={{ color: "var(--muted)" }}>
        ⚠️ Keine Anlageberatung – nur zu Research-Zwecken
      </p>
    );
  }

  return (
    <div
      className={`rounded-xl border px-4 py-3 text-xs ${className}`}
      style={{
        borderColor: "#713f12",
        background: "#1c0a00",
        color: "#fbbf24",
      }}>
      <p className="font-semibold mb-1">⚠️ Haftungsausschluss</p>
      <p>
        Diese App dient ausschließlich zu Research- und Lernzwecken. Alle Scores,
        Kennzahlen und Signale stellen <strong>keine Anlageberatung</strong> dar und
        sind ohne Gewähr. Investitionsentscheidungen auf eigene Verantwortung.
      </p>
    </div>
  );
}
