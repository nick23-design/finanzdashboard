export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      watchlist_items: {
        Row: {
          id: string;
          user_id: string;
          symbol: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          symbol: string;
          name?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          symbol?: string;
          name?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "watchlist_items_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      asset_snapshots: {
        Row: {
          id: string;
          symbol: string;
          price: number | null;
          currency: string | null;
          pe_ratio: number | null;
          market_cap: number | null;
          debt_to_equity: number | null;
          revenue_growth: number | null;
          free_cashflow: number | null;
          rsi: number | null;
          moving_average_50: number | null;
          moving_average_200: number | null;
          fetched_at: string;
        };
        Insert: {
          id?: string;
          symbol: string;
          price?: number | null;
          currency?: string | null;
          pe_ratio?: number | null;
          market_cap?: number | null;
          debt_to_equity?: number | null;
          revenue_growth?: number | null;
          free_cashflow?: number | null;
          rsi?: number | null;
          moving_average_50?: number | null;
          moving_average_200?: number | null;
          fetched_at?: string;
        };
        Update: {
          id?: string;
          symbol?: string;
          price?: number | null;
          currency?: string | null;
          pe_ratio?: number | null;
          market_cap?: number | null;
          debt_to_equity?: number | null;
          revenue_growth?: number | null;
          free_cashflow?: number | null;
          rsi?: number | null;
          moving_average_50?: number | null;
          moving_average_200?: number | null;
          fetched_at?: string;
        };
        Relationships: [];
      };
      analysis_scores: {
        Row: {
          id: string;
          symbol: string;
          total_score: number;
          fundamental_score: number;
          technical_score: number;
          risk_score: number;
          signal: string;
          explanation: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          symbol: string;
          total_score: number;
          fundamental_score: number;
          technical_score: number;
          risk_score: number;
          signal: string;
          explanation: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          symbol?: string;
          total_score?: number;
          fundamental_score?: number;
          technical_score?: number;
          risk_score?: number;
          signal?: string;
          explanation?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      ai_analyses: {
        Row: {
          id: string;
          symbol: string;
          recommendation: string;
          conviction: number;
          summary: string;
          bull_case: Json;
          bear_case: Json;
          growth_outlook: string;
          fundamental_rating: number;
          fundamental_positives: Json;
          fundamental_risks: Json;
          valuation_comment: string;
          news_sentiment: string;
          news_themes: Json;
          sentiment_summary: string;
          extra_data: Json;
          analyzed_at: string;
        };
        Insert: {
          id?: string;
          symbol: string;
          recommendation: string;
          conviction: number;
          summary: string;
          bull_case: Json;
          bear_case: Json;
          growth_outlook: string;
          fundamental_rating: number;
          fundamental_positives: Json;
          fundamental_risks: Json;
          valuation_comment: string;
          news_sentiment: string;
          news_themes: Json;
          sentiment_summary: string;
          extra_data?: Json;
          analyzed_at?: string;
        };
        Update: {
          id?: string;
          symbol?: string;
          recommendation?: string;
          conviction?: number;
          summary?: string;
          bull_case?: Json;
          bear_case?: Json;
          growth_outlook?: string;
          fundamental_rating?: number;
          fundamental_positives?: Json;
          fundamental_risks?: Json;
          valuation_comment?: string;
          news_sentiment?: string;
          news_themes?: Json;
          sentiment_summary?: string;
          extra_data?: Json;
          analyzed_at?: string;
        };
        Relationships: [];
      };
      portfolio_positions: {
        Row: {
          id: string;
          user_id: string;
          symbol: string;
          name: string;
          shares: number;
          purchase_price: number;
          purchase_date: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          symbol: string;
          name?: string;
          shares: number;
          purchase_price: number;
          purchase_date: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          symbol?: string;
          name?: string;
          shares?: number;
          purchase_price?: number;
          purchase_date?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      hot_picks: {
        Row: {
          id: string;
          user_id: string;
          symbol: string;
          name: string;
          price: number | null;
          signal: string;
          score: number;
          reason: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          symbol: string;
          name: string;
          price?: number | null;
          signal: string;
          score: number;
          reason: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          symbol?: string;
          name?: string;
          price?: number | null;
          signal?: string;
          score?: number;
          reason?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      price_alerts: {
        Row: {
          id: string;
          user_id: string;
          symbol: string;
          name: string;
          target_price: number;
          direction: "above" | "below";
          triggered: boolean;
          triggered_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          symbol: string;
          name?: string;
          target_price: number;
          direction: "above" | "below";
          triggered?: boolean;
          triggered_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          symbol?: string;
          name?: string;
          target_price?: number;
          direction?: "above" | "below";
          triggered?: boolean;
          triggered_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}

export type AIAnalysis = Database["public"]["Tables"]["ai_analyses"]["Row"];
export type HotPick = Database["public"]["Tables"]["hot_picks"]["Row"];
export type PortfolioPosition = Database["public"]["Tables"]["portfolio_positions"]["Row"];
export type PriceAlert = Database["public"]["Tables"]["price_alerts"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type WatchlistItem = Database["public"]["Tables"]["watchlist_items"]["Row"];
export type AssetSnapshot = Database["public"]["Tables"]["asset_snapshots"]["Row"];
export type AnalysisScore = Database["public"]["Tables"]["analysis_scores"]["Row"];
