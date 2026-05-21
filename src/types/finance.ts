export interface AssetData {
  symbol: string;
  name: string;
  price: number | null;
  currency: string | null;
  peRatio: number | null;
  marketCap: number | null;
  debtToEquity: number | null;
  revenueGrowth: number | null;
  freeCashflow: number | null;
  rsi: number | null;
  movingAverage50: number | null;
  movingAverage200: number | null;
  fetchedAt: string;
}

export interface ScoreResult {
  symbol: string;
  totalScore: number;
  fundamentalScore: number;
  technicalScore: number;
  riskScore: number;
  signal: SignalType;
  explanation: string;
}

export type SignalType =
  | "Bullish"
  | "Slightly Bullish"
  | "Neutral"
  | "Caution"
  | "High Risk";

export interface PricePoint {
  time: string; // YYYY-MM-DD
  value: number;
}

export interface ApiError {
  error: string;
  details?: string;
}
