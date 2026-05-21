/**
 * In-memory sliding-window rate limiter.
 * Resets on server restart — sufficient for single-instance / dev use.
 * Swap the store for Redis (Upstash) when scaling horizontally.
 */

interface Window {
  count: number;
  resetAt: number;
}

const store = new Map<string, Window>();

// Prune expired entries every 5 minutes to avoid memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, win] of store) {
    if (win.resetAt < now) store.delete(key);
  }
}, 5 * 60 * 1000);

interface RateLimitOptions {
  /** Unique key (e.g. `ip:userId:route`) */
  key: string;
  /** Max allowed requests in the window */
  limit: number;
  /** Window length in seconds */
  windowSecs: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Unix ms
}

export function rateLimit({ key, limit, windowSecs }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSecs * 1000;

  let win = store.get(key);

  if (!win || win.resetAt < now) {
    win = { count: 0, resetAt: now + windowMs };
    store.set(key, win);
  }

  win.count += 1;

  return {
    allowed: win.count <= limit,
    remaining: Math.max(0, limit - win.count),
    resetAt: win.resetAt,
  };
}
