import { z } from "zod";

export const tickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(10)
  .regex(/^[A-Z0-9.\-]+$/, "Ungültiges Ticker-Symbol");

export const addWatchlistSchema = z.object({
  symbol: tickerSchema,
  name: z.string().trim().max(200).optional().default(""),
});

export type AddWatchlistInput = z.infer<typeof addWatchlistSchema>;
