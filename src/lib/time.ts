/** Returns the next occurrence of a UTC cron time on a Mon–Fri weekday. */
export function getNextWeekdayCron(utcHour: number, utcMinute: number): Date {
  const now = new Date();
  const candidate = new Date(now);
  candidate.setUTCHours(utcHour, utcMinute, 0, 0);

  while (
    candidate.getTime() <= now.getTime() ||
    candidate.getUTCDay() === 0 ||
    candidate.getUTCDay() === 6
  ) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
    candidate.setUTCHours(utcHour, utcMinute, 0, 0);
  }

  return candidate;
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "gleich";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(diff / 3_600_000);
  if (h >= 1) return `vor ${h}h`;
  if (m >= 1) return `vor ${m}m`;
  return "gerade eben";
}
