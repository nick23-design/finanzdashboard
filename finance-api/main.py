"""
Finanzdashboard – Finance Data API (FastAPI + yfinance)
Run: uvicorn main:app --reload --port 8000
"""

import math
import os
import re
from datetime import datetime, timezone
from typing import Optional

import yfinance as yf
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Finanzdashboard Finance API", version="0.1.0")

# ALLOWED_ORIGINS = comma-separated list, e.g. "https://app.vercel.app,http://localhost:3000"
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)

TICKER_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")


class AssetResponse(BaseModel):
    symbol: str
    name: str
    price: Optional[float]
    currency: Optional[str]
    pe_ratio: Optional[float]
    market_cap: Optional[int]
    debt_to_equity: Optional[float]
    revenue_growth: Optional[float]
    free_cashflow: Optional[int]
    rsi: Optional[float]
    moving_average_50: Optional[float]
    moving_average_200: Optional[float]
    fetched_at: str


class PricePoint(BaseModel):
    time: str
    value: float


def _safe_float(value) -> Optional[float]:
    """Convert to float, return None for NaN/None."""
    if value is None:
        return None
    try:
        f = float(value)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def _safe_int(value) -> Optional[int]:
    f = _safe_float(value)
    return int(f) if f is not None else None


def _compute_rsi(prices: list[float], period: int = 14) -> Optional[float]:
    if len(prices) < period + 1:
        return None
    deltas = [prices[i] - prices[i - 1] for i in range(1, len(prices))]
    gains = [d if d > 0 else 0.0 for d in deltas[-period:]]
    losses = [-d if d < 0 else 0.0 for d in deltas[-period:]]
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/assets/{symbol}", response_model=AssetResponse)
def get_asset(symbol: str, request: Request):
    symbol = symbol.upper().strip()
    if not TICKER_RE.match(symbol):
        raise HTTPException(status_code=400, detail="Ungültiges Ticker-Symbol")

    try:
        ticker = yf.Ticker(symbol)

        # ticker.info kann bei Yahoo-Änderungen leer/fehlerhaft sein – separat abfangen
        try:
            info = ticker.info or {}
            # Prüfen ob wir überhaupt sinnvolle Daten bekommen haben
            if not info.get("symbol") and not info.get("shortName") and not info.get("regularMarketPrice"):
                info = {}
        except Exception:
            info = {}

        # Historische Kurse – zuverlässiger als .info
        try:
            hist = ticker.history(period="1y", auto_adjust=True)
            close_prices: list[float] = hist["Close"].tolist() if not hist.empty else []
        except Exception:
            hist = None
            close_prices = []

        # Preis aus History falls .info leer
        last_price = (
            _safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))
            or (_safe_float(close_prices[-1]) if close_prices else None)
        )

        if last_price is None and not close_prices:
            raise HTTPException(status_code=404, detail=f"Ticker '{symbol}' nicht gefunden oder keine Daten verfügbar")

        rsi = _compute_rsi(close_prices)
        ma50 = _safe_float(sum(close_prices[-50:]) / 50) if len(close_prices) >= 50 else None
        ma200 = _safe_float(sum(close_prices[-200:]) / 200) if len(close_prices) >= 200 else None

        return AssetResponse(
            symbol=symbol,
            name=info.get("longName") or info.get("shortName") or symbol,
            price=last_price,
            currency=info.get("currency", "USD"),
            pe_ratio=_safe_float(info.get("trailingPE") or info.get("forwardPE")),
            market_cap=_safe_int(info.get("marketCap")),
            debt_to_equity=_safe_float(info.get("debtToEquity")),
            revenue_growth=_safe_float(info.get("revenueGrowth")),
            free_cashflow=_safe_int(info.get("freeCashflow")),
            rsi=rsi,
            moving_average_50=ma50,
            moving_average_200=ma200,
            fetched_at=datetime.now(timezone.utc).isoformat(),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Datenabruf fehlgeschlagen: {str(exc)}",
        ) from exc


@app.get("/assets/{symbol}/history", response_model=list[PricePoint])
def get_history(symbol: str, period: str = "6mo"):
    symbol = symbol.upper().strip()
    if not TICKER_RE.match(symbol):
        raise HTTPException(status_code=400, detail="Ungültiges Ticker-Symbol")

    allowed_periods = {"1mo", "3mo", "6mo", "1y", "2y", "5y"}
    if period not in allowed_periods:
        raise HTTPException(status_code=400, detail="Ungültiger Zeitraum")

    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period=period)
        if hist.empty:
            raise HTTPException(status_code=404, detail="Keine Kursdaten gefunden")

        return [
            PricePoint(time=str(idx.date()), value=round(float(row["Close"]), 4))
            for idx, row in hist.iterrows()
        ]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
