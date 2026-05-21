import type { AssetSnapshot } from "@/types/database";
import type { ScoreResult, SignalType } from "@/types/finance";

// ---------------------------------------------------------------------------
// Sub-scorers – each returns 0–100 with a partial explanation
// ---------------------------------------------------------------------------

interface SubScore {
  score: number;
  notes: string[];
}

function scoreFundamentals(snapshot: AssetSnapshot): SubScore {
  const notes: string[] = [];
  let points = 0;
  let maxPoints = 0;

  // KGV / P/E ratio (lower is better, ideal 0–20)
  if (snapshot.pe_ratio !== null) {
    maxPoints += 35;
    if (snapshot.pe_ratio <= 0) {
      notes.push("KGV negativ (Verlustunternehmen)");
    } else if (snapshot.pe_ratio <= 15) {
      points += 35;
      notes.push(`KGV ${snapshot.pe_ratio.toFixed(1)} – günstig bewertet`);
    } else if (snapshot.pe_ratio <= 25) {
      points += 25;
      notes.push(`KGV ${snapshot.pe_ratio.toFixed(1)} – moderat bewertet`);
    } else if (snapshot.pe_ratio <= 40) {
      points += 12;
      notes.push(`KGV ${snapshot.pe_ratio.toFixed(1)} – hoch bewertet`);
    } else {
      points += 0;
      notes.push(`KGV ${snapshot.pe_ratio.toFixed(1)} – sehr hoch bewertet`);
    }
  }

  // Free Cash Flow (positive is good)
  if (snapshot.free_cashflow !== null) {
    maxPoints += 35;
    if (snapshot.free_cashflow > 0) {
      points += 35;
      notes.push("Positiver Free Cashflow");
    } else {
      points += 0;
      notes.push("Negativer Free Cashflow");
    }
  }

  // Revenue Growth (higher is better)
  if (snapshot.revenue_growth !== null) {
    maxPoints += 30;
    const growth = snapshot.revenue_growth * 100;
    if (growth >= 20) {
      points += 30;
      notes.push(`Umsatzwachstum ${growth.toFixed(1)}% – stark`);
    } else if (growth >= 10) {
      points += 22;
      notes.push(`Umsatzwachstum ${growth.toFixed(1)}% – solide`);
    } else if (growth >= 0) {
      points += 12;
      notes.push(`Umsatzwachstum ${growth.toFixed(1)}% – schwach`);
    } else {
      points += 0;
      notes.push(`Umsatzrückgang ${growth.toFixed(1)}%`);
    }
  }

  const score = maxPoints > 0 ? (points / maxPoints) * 100 : 50;
  return { score: Math.round(score), notes };
}

function scoreTechnicals(snapshot: AssetSnapshot): SubScore {
  const notes: string[] = [];
  let points = 0;
  let maxPoints = 0;

  // RSI (30–70 healthy; <30 oversold = buying opp; >70 overbought)
  if (snapshot.rsi !== null) {
    maxPoints += 40;
    const rsi = snapshot.rsi;
    if (rsi < 30) {
      points += 35; // oversold – potential buy
      notes.push(`RSI ${rsi.toFixed(1)} – überverkauft (potenzielle Kaufgelegenheit)`);
    } else if (rsi <= 50) {
      points += 40;
      notes.push(`RSI ${rsi.toFixed(1)} – neutrale bis positive Zone`);
    } else if (rsi <= 70) {
      points += 25;
      notes.push(`RSI ${rsi.toFixed(1)} – leicht überkauft`);
    } else {
      points += 5;
      notes.push(`RSI ${rsi.toFixed(1)} – stark überkauft`);
    }
  }

  // Price vs 50-day MA
  if (snapshot.price !== null && snapshot.moving_average_50 !== null) {
    maxPoints += 30;
    const pct = ((snapshot.price - snapshot.moving_average_50) / snapshot.moving_average_50) * 100;
    if (pct >= 0 && pct <= 10) {
      points += 30;
      notes.push(`Kurs ${pct.toFixed(1)}% über 50-Tage-MA – bullish`);
    } else if (pct > 10) {
      points += 15;
      notes.push(`Kurs ${pct.toFixed(1)}% über 50-Tage-MA – mögliche Überdehnung`);
    } else {
      points += 8;
      notes.push(`Kurs ${Math.abs(pct).toFixed(1)}% unter 50-Tage-MA`);
    }
  }

  // Price vs 200-day MA (Golden/Death Cross proxy)
  if (snapshot.price !== null && snapshot.moving_average_200 !== null) {
    maxPoints += 30;
    if (snapshot.price > snapshot.moving_average_200) {
      points += 30;
      notes.push("Kurs über 200-Tage-MA – Langfristtrend positiv");
    } else {
      points += 5;
      notes.push("Kurs unter 200-Tage-MA – Langfristtrend negativ");
    }
  }

  const score = maxPoints > 0 ? (points / maxPoints) * 100 : 50;
  return { score: Math.round(score), notes };
}

function scoreRisk(snapshot: AssetSnapshot): SubScore {
  const notes: string[] = [];
  let points = 0;
  let maxPoints = 0;

  // Debt-to-Equity (lower is safer)
  if (snapshot.debt_to_equity !== null) {
    maxPoints += 50;
    const de = snapshot.debt_to_equity;
    if (de < 0) {
      points += 10;
      notes.push("Negatives Eigenkapital – erhöhtes Risiko");
    } else if (de <= 0.5) {
      points += 50;
      notes.push(`Debt/Equity ${de.toFixed(2)} – sehr niedrige Verschuldung`);
    } else if (de <= 1.0) {
      points += 38;
      notes.push(`Debt/Equity ${de.toFixed(2)} – moderate Verschuldung`);
    } else if (de <= 2.0) {
      points += 20;
      notes.push(`Debt/Equity ${de.toFixed(2)} – hohe Verschuldung`);
    } else {
      points += 5;
      notes.push(`Debt/Equity ${de.toFixed(2)} – sehr hohe Verschuldung`);
    }
  }

  // RSI as volatility proxy (extreme values = higher risk)
  if (snapshot.rsi !== null) {
    maxPoints += 25;
    const rsi = snapshot.rsi;
    if (rsi >= 35 && rsi <= 65) {
      points += 25;
      notes.push("RSI im stabilen Bereich");
    } else if (rsi >= 25 && rsi <= 75) {
      points += 15;
      notes.push("RSI leicht außerhalb des stabilen Bereichs");
    } else {
      points += 5;
      notes.push("RSI in extremer Zone – erhöhte Volatilität");
    }
  }

  // MA spread as trend stability indicator
  if (snapshot.moving_average_50 !== null && snapshot.moving_average_200 !== null) {
    maxPoints += 25;
    const spread = Math.abs(
      (snapshot.moving_average_50 - snapshot.moving_average_200) /
        snapshot.moving_average_200
    ) * 100;
    if (spread <= 5) {
      points += 25;
      notes.push("MA-Spread eng – stabiler Trend");
    } else if (spread <= 15) {
      points += 15;
      notes.push("MA-Spread moderat");
    } else {
      points += 5;
      notes.push("MA-Spread weit – volatiler Markt");
    }
  }

  const score = maxPoints > 0 ? (points / maxPoints) * 100 : 50;
  return { score: Math.round(score), notes };
}

// ---------------------------------------------------------------------------
// Signal mapping
// ---------------------------------------------------------------------------

function toSignal(total: number): SignalType {
  if (total >= 80) return "Bullish";
  if (total >= 60) return "Slightly Bullish";
  if (total >= 40) return "Neutral";
  if (total >= 20) return "Caution";
  return "High Risk";
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

export function calculateScore(snapshot: AssetSnapshot): ScoreResult {
  const fundamental = scoreFundamentals(snapshot);
  const technical = scoreTechnicals(snapshot);
  const risk = scoreRisk(snapshot);

  // Weighted: Fundamental 40%, Technical 30%, Risk 30%
  const total = Math.round(
    fundamental.score * 0.4 + technical.score * 0.3 + risk.score * 0.3
  );

  const signal = toSignal(total);

  const allNotes = [
    "FUNDAMENTAL:",
    ...fundamental.notes,
    "TECHNISCH:",
    ...technical.notes,
    "RISIKO:",
    ...risk.notes,
  ];

  const explanation =
    `${snapshot.symbol} – Signal: ${signal} (Score ${total}/100). ` + allNotes.join(" | ");

  return {
    symbol: snapshot.symbol,
    totalScore: total,
    fundamentalScore: fundamental.score,
    technicalScore: technical.score,
    riskScore: risk.score,
    signal,
    explanation,
  };
}
