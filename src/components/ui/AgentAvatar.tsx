"use client";

// Agent definitions – swap src to a local /public/agents/{id}.png for real AI-generated photos
export const AGENTS = {
  finn:           { name: "Finn",             description: "Autonomer Markt-Analyst",          seed: "FinnNHAgent",       color: "#f59e0b" },
  "us-scout":     { name: "US-Scout",         description: "US-Markt Analyst",                 seed: "USScoutNH",         color: "#3b82f6" },
  "de-scout":     { name: "DE-Scout",         description: "DE-Markt Analyst",                 seed: "DEScoutNH",         color: "#6ECF97" },
  "podcast-scout":{ name: "Podcast-Scout",    description: "Investment-Podcast Analyst",       seed: "PodcastScoutNH",    color: "#8b5cf6" },
  synthesizer:    { name: "Synthesizer",      description: "Chef-Analyst NH Select",           seed: "SynthesizerNH",     color: "#6366f1" },
  radar:          { name: "Radar",             description: "Autonomer Trend-Scanner",          seed: "RadarNHAgent",      color: "#22c55e" },
  opus:           { name: "Opus",             description: "Leitender Investment-Stratege",    seed: "OpusNHAgent",       color: "#f59e0b" },
  felix:          { name: "Felix",            description: "Fundamental-Analyst",              seed: "FelixNHAgent",      color: "#3b82f6" },
  nina:           { name: "Nina",             description: "Sentiment-Analystin",              seed: "NinaNHAgent",       color: "#8b5cf6" },
  marco:          { name: "Marco",            description: "Markt-Intelligence-Spezialist",    seed: "MarcoNHAgent",      color: "#f97316" },
  vera:           { name: "Vera",             description: "Fakten-Prüferin",                  seed: "VeraNHAgent",       color: "#ef4444" },
  kai:            { name: "Kai",              description: "Vergleichs-Analyst",               seed: "KaiNHAgent",        color: "#6366f1" },
  lena:           { name: "Lena",             description: "News-Kuratorin",                   seed: "LenaNHAgent",       color: "#06b6d4" },
  lisa:           { name: "Lisa",             description: "News-Kuratorin",                   seed: "LisaNHAgent",       color: "#06b6d4" },
} as const;

export type AgentId = keyof typeof AGENTS;

const SIZE = {
  xs: { wh: "w-6 h-6",   px: 24, ring: 1.5, dot: "w-2 h-2" },
  sm: { wh: "w-8 h-8",   px: 32, ring: 2,   dot: "w-2.5 h-2.5" },
  md: { wh: "w-10 h-10", px: 40, ring: 2,   dot: "w-3 h-3" },
  lg: { wh: "w-14 h-14", px: 56, ring: 2.5, dot: "w-3.5 h-3.5" },
} as const;

interface AgentAvatarProps {
  agent: AgentId;
  size?: keyof typeof SIZE;
  showName?: boolean;
  working?: boolean;
  className?: string;
}

export function AgentAvatar({
  agent,
  size = "sm",
  showName = false,
  working = false,
  className = "",
}: AgentAvatarProps) {
  const cfg = AGENTS[agent];
  const s = SIZE[size];
  const src = `/agents/${agent}.png`;
  const fallback = `https://api.dicebear.com/9.x/notionists/svg?seed=${cfg.seed}&radius=50&size=${s.px * 2}`;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative flex-shrink-0">
        <div
          className={`${s.wh} rounded-full overflow-hidden`}
          style={{
            border: `${s.ring}px solid ${cfg.color}`,
            background: cfg.color + "20",
          }}>
          <img
            src={src}
            alt={cfg.name}
            width={s.px}
            height={s.px}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = fallback;
            }}
          />
        </div>
        {working && (
          <span
            className={`absolute -bottom-0.5 -right-0.5 ${s.dot} rounded-full animate-pulse`}
            style={{
              background: cfg.color,
              border: "1.5px solid var(--card)",
            }}
          />
        )}
      </div>

      {showName && (
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white leading-none truncate">{cfg.name}</p>
          {size === "md" && (
            <p className="text-[10px] mt-0.5 leading-none truncate" style={{ color: "var(--muted)" }}>
              {cfg.description}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Horizontal row of overlapping avatars (e.g. "analysiert von 3 Agenten") */
export function AgentAvatarGroup({
  agents,
  size = "xs",
  label,
}: {
  agents: AgentId[];
  size?: keyof typeof SIZE;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-1.5">
        {agents.map((a) => (
          <AgentAvatar key={a} agent={a} size={size} />
        ))}
      </div>
      {label && (
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {label}
        </span>
      )}
    </div>
  );
}
