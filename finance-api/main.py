"""
Finanzdashboard – Finance Data API (FastAPI + yfinance)
Run: uvicorn main:app --reload --port 8000
"""

import json
import math
import os
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError, as_completed
from datetime import datetime, timezone
from typing import Any, Optional

import yfinance as yf
from fastapi import FastAPI, HTTPException, Query, Request
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

TICKER_RE = re.compile(r"^[A-Z0-9.\-=]{1,30}$")
EDGAR_COMPANYFACTS_TIMEOUT_SECS = 8
EDGAR_CONCEPT_TIMEOUT_SECS = 4
INSIDER_SUBMISSIONS_TIMEOUT_SECS = 7
INSIDER_FORM4_TIMEOUT_SECS = 4
INSIDER_FORM4_SCAN_LIMIT = 10
INSIDER_PARSE_BUDGET_SECS = 9


class AssetResponse(BaseModel):
    symbol: str
    name: str
    price: Optional[float]
    currency: Optional[str]
    isin: Optional[str]
    description: Optional[str]
    pe_ratio: Optional[float]
    market_cap: Optional[int]
    debt_to_equity: Optional[float]
    revenue_growth: Optional[float]
    free_cashflow: Optional[int]
    rsi: Optional[float]
    moving_average_50: Optional[float]
    moving_average_200: Optional[float]
    price_change: Optional[float]
    price_change_pct: Optional[float]
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


def _raw_value(value):
    """Extract Yahoo Finance's nested {raw, fmt} values."""
    if isinstance(value, dict):
        return value.get("raw", value.get("fmt"))
    return value


def _raw_float(value) -> Optional[float]:
    return _safe_float(_raw_value(value))


def _raw_int(value) -> Optional[int]:
    return _safe_int(_raw_value(value))


def _fetch_yahoo_quote_summary(symbol: str, modules: list[str]) -> dict[str, Any]:
    """Direct Yahoo quoteSummary fallback for fields yfinance sometimes omits."""
    if not modules:
        return {}
    url = (
        "https://query2.finance.yahoo.com/v10/finance/quoteSummary/"
        f"{urllib.parse.quote(symbol)}?modules={urllib.parse.quote(','.join(modules))}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=8) as resp:
        data = json.loads(resp.read())
    result = (data.get("quoteSummary") or {}).get("result") or []
    return result[0] if result else {}


def _statement_row_latest(frame, labels: list[str]) -> Optional[float]:
    """Read the latest available row value from a yfinance statement dataframe."""
    if frame is None or getattr(frame, "empty", True):
        return None
    for label in labels:
        if label not in frame.index:
            continue
        values = frame.loc[label].dropna()
        if len(values) == 0:
            continue
        return _safe_float(values.iloc[0])
    return None


def _statement_row_series(frame, labels: list[str], max_items: int = 8, form: str = "YF-Q") -> list[dict]:
    """Convert a yfinance statement row into EdgarFacts-compatible periods."""
    if frame is None or getattr(frame, "empty", True):
        return []
    for label in labels:
        if label not in frame.index:
            continue
        values = frame.loc[label].dropna()
        items = []
        for period, value in values.items():
            val = _safe_int(value)
            if val is None:
                continue
            try:
                period_str = period.strftime("%Y-%m-%d")
            except Exception:
                period_str = str(period)[:10]
            items.append({"period": period_str, "value": val, "form": form})
        return sorted(items, key=lambda x: x["period"], reverse=True)[:max_items]
    return []


def _fallback_pe_from_statements(ticker: yf.Ticker, last_price: Optional[float]) -> Optional[float]:
    if not last_price:
        return None
    try:
        quarterly = ticker.get_income_stmt(freq="quarterly")
        if quarterly is not None and not quarterly.empty:
            for label in ["DilutedEPS", "Diluted EPS", "BasicEPS", "Basic EPS"]:
                if label not in quarterly.index:
                    continue
                values = [_safe_float(v) for v in quarterly.loc[label].dropna().tolist()[:4]]
                eps_sum = sum(v for v in values if v is not None)
                if eps_sum > 0:
                    return round(last_price / eps_sum, 2)
    except Exception:
        pass
    try:
        yearly = ticker.get_income_stmt(freq="yearly")
        eps = _statement_row_latest(yearly, ["DilutedEPS", "Diluted EPS", "BasicEPS", "Basic EPS"])
        if eps and eps > 0:
            return round(last_price / eps, 2)
    except Exception:
        pass
    return None


def _fallback_debt_to_equity(ticker: yf.Ticker) -> Optional[float]:
    """Return Yahoo-compatible Debt/Equity in percent (debt / equity * 100)."""
    for freq in ("quarterly", "yearly"):
        try:
            bs = ticker.get_balance_sheet(freq=freq)
            total_debt = _statement_row_latest(bs, [
                "TotalDebt", "Total Debt",
                "LongTermDebtAndFinanceLeaseObligation", "Long Term Debt And Finance Lease Obligation",
            ])
            if total_debt is None:
                long_debt = _statement_row_latest(bs, ["LongTermDebt", "Long Term Debt"])
                current_debt = _statement_row_latest(bs, ["CurrentDebt", "Current Debt"])
                if long_debt is not None or current_debt is not None:
                    total_debt = (long_debt or 0) + (current_debt or 0)
            equity = _statement_row_latest(bs, [
                "StockholdersEquity", "Stockholders Equity",
                "TotalEquityGrossMinorityInterest", "Total Equity Gross Minority Interest",
            ])
            if total_debt is not None and equity and equity != 0:
                return round((total_debt / equity) * 100, 3)
        except Exception:
            continue
    return None


# ── ISIN helpers ─────────────────────────────────────────────────────────────

_isin_cache: dict[str, str] = {}  # symbol → ISIN; survives for process lifetime


def _extract_isin(candidate) -> Optional[str]:
    if candidate and str(candidate).strip().upper() not in ("NONE", "N/A", ""):
        return str(candidate).strip()
    return None


def _fetch_isin_eodhd(symbol: str) -> Optional[str]:
    """ISIN via EODHD search endpoint (free tier). Cached in-process per symbol.
    Takes the primary listing's ISIN; falls back to first result if none marked primary."""
    api_key = os.getenv("EODHD_API_KEY")
    if not api_key:
        return None

    base = symbol.split(".")[0].upper()  # strip exchange suffix (e.g. SAP from SAP.DE)

    if base in _isin_cache:
        return _isin_cache[base]

    try:
        url = f"https://eodhd.com/api/search/{urllib.parse.quote(base)}?api_token={api_key}&limit=10"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=8) as r:
            results = json.loads(r.read())

        if not isinstance(results, list):
            return None

        # Prefer isPrimary=true with matching ticker; fall back to first code match
        primary_isin = None
        fallback_isin = None
        for item in results:
            if item.get("Code", "").upper() != base:
                continue
            isin = _extract_isin(item.get("ISIN"))
            if not isin:
                continue
            if item.get("isPrimary"):
                primary_isin = isin
                break
            if fallback_isin is None:
                fallback_isin = isin

        isin = primary_isin or fallback_isin
        if isin:
            _isin_cache[base] = isin
        return isin
    except Exception:
        return None


def _fetch_isin_via_quote_type(ticker_sym: str) -> Optional[str]:
    """Fallback: Yahoo Finance quoteSummary quoteType module (European listings only)."""
    try:
        url = (
            f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/"
            f"{urllib.parse.quote(ticker_sym)}?modules=quoteType"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
        result = (data.get("quoteSummary") or {}).get("result") or []
        qt = result[0].get("quoteType", {}) if result else {}
        return _extract_isin(qt.get("isin"))
    except Exception:
        return None


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


class SearchResult(BaseModel):
    symbol: str
    name: str
    exchange: Optional[str]
    type: Optional[str]


@app.get("/search", response_model=list[SearchResult])
def search_stocks(q: str = Query(..., min_length=1, max_length=50)):
    q = q.strip()
    if not q:
        return []
    try:
        url = (
            "https://query1.finance.yahoo.com/v1/finance/search"
            f"?q={urllib.parse.quote(q)}&quotesCount=10&newsCount=0&enableFuzzyQuery=false"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
        results = []
        for item in data.get("quotes", []):
            symbol = item.get("symbol", "")
            quote_type = item.get("quoteType", "")
            # Exclude Yahoo-internal fund codes (0P...) and mutual funds — no reliable price data
            if not symbol or symbol.startswith("0P") or quote_type == "MUTUALFUND":
                continue
            name = item.get("longname") or item.get("shortname") or symbol
            results.append(SearchResult(
                symbol=symbol,
                name=name,
                exchange=item.get("exchange"),
                type=quote_type,
            ))
        return results
    except Exception:
        return []


@app.get("/trending")
def get_trending():
    """Currently trending ticker symbols on Yahoo Finance (US market)."""
    try:
        url = "https://query1.finance.yahoo.com/v1/finance/trending/US?count=15"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
        quotes = data.get("finance", {}).get("result", [{}])[0].get("quotes", [])
        return [{"symbol": q.get("symbol", "").strip()} for q in quotes if q.get("symbol")]
    except Exception:
        return []


@app.get("/health")
def health():
    return {"status": "ok", "eodhd_configured": bool(os.getenv("EODHD_API_KEY"))}


INDICES = [
    {"symbol": "^GSPC",  "name": "S&P 500"},
    {"symbol": "^IXIC",  "name": "NASDAQ"},
    {"symbol": "^GDAXI", "name": "DAX"},
    {"symbol": "^DJI",   "name": "Dow Jones"},
]


def _fetch_index(symbol: str, name: str) -> dict:
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="5d", interval="1d", auto_adjust=True)
        close_prices = [float(c) for c in hist["Close"].dropna().tolist()]
        if not close_prices:
            return {"symbol": symbol, "name": name, "price": None, "change_pct": None}
        price = round(close_prices[-1], 2)
        change_pct = None
        if len(close_prices) >= 2 and close_prices[-2] != 0:
            change_pct = round((close_prices[-1] - close_prices[-2]) / close_prices[-2] * 100, 2)
        return {"symbol": symbol, "name": name, "price": price, "change_pct": change_pct}
    except Exception:
        return {"symbol": symbol, "name": name, "price": None, "change_pct": None}


@app.get("/market/indices")
def get_market_indices():
    results = []
    with ThreadPoolExecutor(max_workers=4) as ex:
        futures = {ex.submit(_fetch_index, idx["symbol"], idx["name"]): idx for idx in INDICES}
        for future in as_completed(futures):
            results.append(future.result())
    # Return in original order
    order = {idx["symbol"]: i for i, idx in enumerate(INDICES)}
    results.sort(key=lambda r: order.get(r["symbol"], 99))
    return results


@app.get("/assets/{symbol}", response_model=AssetResponse)
def get_asset(symbol: str, request: Request):
    symbol = symbol.upper().strip()
    if not TICKER_RE.match(symbol):
        raise HTTPException(status_code=400, detail="Ungültiges Ticker-Symbol")

    try:
        ticker = yf.Ticker(symbol)
        quote_summary: dict[str, Any] = {}
        try:
            quote_summary = _fetch_yahoo_quote_summary(symbol, [
                "price",
                "summaryDetail",
                "defaultKeyStatistics",
                "financialData",
            ])
        except Exception:
            quote_summary = {}

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
        price_module = quote_summary.get("price", {})
        financial_data = quote_summary.get("financialData", {})
        summary_detail = quote_summary.get("summaryDetail", {})
        default_stats = quote_summary.get("defaultKeyStatistics", {})

        last_price = (
            _safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))
            or _raw_float(financial_data.get("currentPrice"))
            or _raw_float(price_module.get("regularMarketPrice"))
            or (_safe_float(close_prices[-1]) if close_prices else None)
        )

        if last_price is None and not close_prices:
            raise HTTPException(status_code=404, detail=f"Ticker '{symbol}' nicht gefunden oder keine Daten verfügbar")

        rsi = _compute_rsi(close_prices)
        ma50 = _safe_float(sum(close_prices[-50:]) / 50) if len(close_prices) >= 50 else None
        ma200 = _safe_float(sum(close_prices[-200:]) / 200) if len(close_prices) >= 200 else None

        # Daily change from history (reliable) or info fallback
        price_change = None
        price_change_pct = None
        if len(close_prices) >= 2 and close_prices[-2] != 0:
            price_change = round(close_prices[-1] - close_prices[-2], 4)
            price_change_pct = round((price_change / close_prices[-2]) * 100, 2)
        else:
            price_change = _safe_float(info.get("regularMarketChange"))
            price_change_pct = _safe_float(info.get("regularMarketChangePercent"))

        # ISIN: EODHD as primary source, Yahoo Finance as fallback
        isin: Optional[str] = _fetch_isin_eodhd(symbol)

        if not isin:
            isin = _extract_isin(info.get("isin"))

        if not isin and "." not in symbol:
            for de_suffix in [".F", ".DE"]:
                try:
                    de_ticker = yf.Ticker(symbol + de_suffix)
                    de_info = de_ticker.info or {}
                    isin = _extract_isin(de_info.get("isin"))
                    if isin:
                        break
                except Exception:
                    continue
            if not isin:
                for de_suffix in [".F", ".DE"]:
                    isin = _fetch_isin_via_quote_type(symbol + de_suffix)
                    if isin:
                        break

        description: Optional[str] = info.get("longBusinessSummary") or None

        # fast_info fallback — more reliable for European stocks where .info is sparse
        fast_market_cap: Optional[int] = None
        fast_currency: Optional[str] = None
        try:
            fi = ticker.fast_info
            fast_market_cap = _safe_int(getattr(fi, "market_cap", None))
            fast_currency = getattr(fi, "currency", None) or None
        except Exception:
            pass

        market_cap = _safe_int(info.get("marketCap")) or _raw_int(price_module.get("marketCap")) or fast_market_cap
        currency = info.get("currency") or price_module.get("currency") or fast_currency or "USD"

        pe_ratio = (
            _safe_float(info.get("trailingPE") or info.get("forwardPE"))
            or _raw_float(summary_detail.get("trailingPE"))
            or _raw_float(default_stats.get("trailingPE"))
            or _raw_float(default_stats.get("forwardPE"))
        )
        if pe_ratio is None and last_price:
            eps = (
                _safe_float(info.get("trailingEps") or info.get("forwardEps"))
                or _raw_float(default_stats.get("trailingEps"))
                or _raw_float(default_stats.get("forwardEps"))
            )
            if eps and eps > 0:
                pe_ratio = round(last_price / eps, 2)
        if pe_ratio is None:
            pe_ratio = _fallback_pe_from_statements(ticker, last_price)

        rev_growth = _safe_float(info.get("revenueGrowth")) or _raw_float(financial_data.get("revenueGrowth"))
        if rev_growth is None:
            try:
                income = ticker.get_income_stmt(freq="yearly")
                if income is not None and not income.empty:
                    for row_label in ["TotalRevenue", "Total Revenue"]:
                        if row_label in income.index:
                            revenues = income.loc[row_label].dropna().sort_index(ascending=False)
                            if len(revenues) >= 2:
                                r0, r1 = float(revenues.iloc[0]), float(revenues.iloc[1])
                                if r1 != 0:
                                    rev_growth = round((r0 - r1) / abs(r1), 4)
                            break
            except Exception:
                pass

        fcf = _safe_int(info.get("freeCashflow")) or _raw_int(financial_data.get("freeCashflow"))
        if fcf is None:
            try:
                cf = ticker.get_cash_flow(freq="yearly")
                if cf is not None and not cf.empty:
                    op_cf = None
                    capex = None
                    for label in ["OperatingCashFlow", "Operating Cash Flow"]:
                        if label in cf.index:
                            op_cf = _safe_float(cf.loc[label].dropna().iloc[0])
                            break
                    for label in ["CapitalExpenditure", "Capital Expenditure"]:
                        if label in cf.index:
                            capex = _safe_float(cf.loc[label].dropna().iloc[0])
                            break
                    if op_cf is not None and capex is not None:
                        fcf = _safe_int(op_cf + capex)
                    elif op_cf is not None:
                        fcf = _safe_int(op_cf)
            except Exception:
                pass

        debt_to_equity = (
            _safe_float(info.get("debtToEquity"))
            or _raw_float(financial_data.get("debtToEquity"))
            or _fallback_debt_to_equity(ticker)
        )

        return AssetResponse(
            symbol=symbol,
            name=info.get("longName") or info.get("shortName") or symbol,
            price=last_price,
            currency=currency,
            isin=isin,
            description=description,
            pe_ratio=pe_ratio,
            market_cap=market_cap,
            debt_to_equity=debt_to_equity,
            revenue_growth=rev_growth,
            free_cashflow=fcf,
            rsi=rsi,
            moving_average_50=ma50,
            moving_average_200=ma200,
            price_change=price_change,
            price_change_pct=price_change_pct,
            fetched_at=datetime.now(timezone.utc).isoformat(),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Datenabruf fehlgeschlagen: {str(exc)}",
        ) from exc


class NewsItem(BaseModel):
    title: str
    publisher: str
    published_at: Optional[str]


@app.get("/assets/{symbol}/news", response_model=list[NewsItem])
def get_news(symbol: str):
    symbol = symbol.upper().strip()
    if not TICKER_RE.match(symbol):
        raise HTTPException(status_code=400, detail="Ungültiges Ticker-Symbol")

    try:
        ticker = yf.Ticker(symbol)
        raw_news = ticker.news or []
        items: list[NewsItem] = []

        for item in raw_news[:10]:
            # Handle both old and new yfinance news formats
            content = item.get("content") if isinstance(item.get("content"), dict) else {}
            title = content.get("title") or item.get("title", "")
            provider = content.get("provider", {})
            publisher = (
                provider.get("displayName") if isinstance(provider, dict) else None
            ) or item.get("publisher", "")
            pub_time = content.get("pubDate") or item.get("providerPublishTime")

            if isinstance(pub_time, (int, float)):
                pub_time = datetime.fromtimestamp(pub_time, tz=timezone.utc).isoformat()

            if title:
                items.append(NewsItem(
                    title=str(title),
                    publisher=str(publisher) if publisher else "",
                    published_at=str(pub_time) if pub_time else None,
                ))

        return items
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


class GoogleNewsItem(BaseModel):
    title: str
    source: str
    published: Optional[str]
    url: Optional[str]


class EdgarFacts(BaseModel):
    cik: str
    revenue: list[dict]
    net_income: list[dict]
    gross_profit: list[dict]


# Module-level CIK cache – loaded once per server start
_cik_map: Optional[dict] = None
CIK_OVERRIDES = {
    # Some SEC/Yahoo environments intermittently miss large-cap tickers in
    # company_tickers.json lookups. Keep minimal stable overrides for known gaps.
    "AVGO": "0001730168",
}


def _load_cik_map() -> dict:
    global _cik_map
    if _cik_map is not None:
        return _cik_map
    req = urllib.request.Request(
        "https://www.sec.gov/files/company_tickers.json",
        headers={"User-Agent": "Finanzdashboard/1.0 contact@nexthorizon-ai.com"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    _cik_map = {
        entry["ticker"].upper(): str(entry["cik_str"]).zfill(10)
        for entry in data.values()
    }
    return _cik_map


def _get_cik(ticker: str) -> Optional[str]:
    base = ticker.upper().split(".")[0]
    if base in CIK_OVERRIDES:
        return CIK_OVERRIDES[base]
    try:
        return _load_cik_map().get(ticker.upper()) or _load_cik_map().get(base)
    except Exception:
        return None


def _fetch_edgar_concept(cik: str, concept: str, max_items: int = 8) -> list[dict]:
    url = f"https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/us-gaap/{concept}.json"
    req = urllib.request.Request(
        url, headers={"User-Agent": "Finanzdashboard/1.0 contact@nexthorizon-ai.com"}
    )
    with urllib.request.urlopen(req, timeout=EDGAR_CONCEPT_TIMEOUT_SECS) as resp:
        data = json.loads(resp.read())

    usd_units = data.get("units", {}).get("USD", [])
    seen: dict[str, dict] = {}
    for entry in usd_units:
        form = entry.get("form", "")
        if form not in ("10-Q", "10-K"):
            continue
        period = entry.get("end", "")
        filed = entry.get("filed", "")
        if period not in seen or filed > seen[period]["filed"]:
            seen[period] = {"period": period, "value": entry.get("val", 0), "form": form}

    items = sorted(seen.values(), key=lambda x: x["period"], reverse=True)
    return items[:max_items]


def _fetch_edgar_companyfacts(cik: str) -> dict:
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
    req = urllib.request.Request(
        url, headers={"User-Agent": "Finanzdashboard/1.0 contact@nexthorizon-ai.com"}
    )
    with urllib.request.urlopen(req, timeout=EDGAR_COMPANYFACTS_TIMEOUT_SECS) as resp:
        return json.loads(resp.read())


def _extract_companyfacts_concepts(facts: dict, concepts: list[str], max_items: int = 8) -> list[dict]:
    us_gaap = (facts.get("facts") or {}).get("us-gaap") or {}
    for concept in concepts:
        concept_data = us_gaap.get(concept)
        if not concept_data:
            continue
        usd_units = (concept_data.get("units") or {}).get("USD", [])
        seen: dict[str, dict] = {}
        for entry in usd_units:
            form = entry.get("form", "")
            if form not in ("10-Q", "10-K"):
                continue
            period = entry.get("end", "")
            filed = entry.get("filed", "")
            if not period:
                continue
            if period not in seen or filed > seen[period]["filed"]:
                seen[period] = {"period": period, "value": entry.get("val", 0), "form": form}
        items = sorted(seen.values(), key=lambda x: x["period"], reverse=True)
        if items:
            return items[:max_items]
    return []


def _fetch_yfinance_quarterly_facts(symbol: str) -> dict:
    ticker = yf.Ticker(symbol)
    income = ticker.get_income_stmt(freq="quarterly")
    return {
        "revenue": _statement_row_series(income, [
            "TotalRevenue", "Total Revenue",
            "OperatingRevenue", "Operating Revenue",
        ]),
        "net_income": _statement_row_series(income, ["NetIncome", "Net Income"]),
        "gross_profit": _statement_row_series(income, ["GrossProfit", "Gross Profit"]),
    }


@app.get("/assets/{symbol}/google-news", response_model=list[GoogleNewsItem])
def get_google_news(symbol: str):
    symbol = symbol.upper().strip()
    if not TICKER_RE.match(symbol):
        raise HTTPException(status_code=400, detail="Ungültiges Ticker-Symbol")

    try:
        query = urllib.parse.quote(f"{symbol} stock")
        url = f"https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en"
        req = urllib.request.Request(
            url, headers={"User-Agent": "Mozilla/5.0 (compatible; Finanzdashboard/1.0)"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            root = ET.fromstring(resp.read())

        channel = root.find("channel")
        if channel is None:
            return []

        items = []
        for item in channel.findall("item")[:10]:
            title_el = item.find("title")
            source_el = item.find("source")
            pub_el = item.find("pubDate")
            # <link> in RSS 2.0 sits between tags; try direct find first
            link_el = item.find("link")
            link_url = None
            if link_el is not None and link_el.text:
                link_url = link_el.text.strip()
            else:
                # fallback: iterate children for link text node
                for child in item:
                    if child.tag == "link" and child.text:
                        link_url = child.text.strip()
                        break
            title = title_el.text if title_el is not None else ""
            if title:
                items.append(GoogleNewsItem(
                    title=title,
                    source=source_el.text if source_el is not None else "",
                    published=pub_el.text if pub_el is not None else None,
                    url=link_url,
                ))
        return items
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/assets/{symbol}/edgar-facts", response_model=EdgarFacts)
def get_edgar_facts(symbol: str):
    symbol = symbol.upper().strip()
    if not TICKER_RE.match(symbol):
        raise HTTPException(status_code=400, detail="Ungültiges Ticker-Symbol")

    cik = _get_cik(symbol)
    if not cik:
        raise HTTPException(status_code=404, detail=f"Kein SEC-Eintrag für {symbol}")

    result: dict = {"cik": cik, "revenue": [], "net_income": [], "gross_profit": []}

    revenue_concepts = [
        "Revenues",
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "SalesRevenueNet",
        "SalesRevenueGoodsNet",
        "SalesRevenueServicesNet",
        "OperatingRevenues",
    ]

    companyfacts_available = False
    try:
        facts = _fetch_edgar_companyfacts(cik)
        companyfacts_available = True
        result["revenue"] = _extract_companyfacts_concepts(facts, revenue_concepts)
        result["net_income"] = _extract_companyfacts_concepts(facts, ["NetIncomeLoss"])
        result["gross_profit"] = _extract_companyfacts_concepts(facts, ["GrossProfit"])
    except Exception:
        # SEC companyfacts is the fast path. If it times out, do not spend more
        # time on multiple SEC concept calls; fall through to yfinance statements.
        pass

    # If companyfacts responded but a single concept was absent, try a short
    # companyconcept fallback for the missing field only.
    if companyfacts_available:
        if not result["revenue"]:
            for concept in revenue_concepts[:3]:
                try:
                    result["revenue"] = _fetch_edgar_concept(cik, concept)
                    if result["revenue"]:
                        break
                except Exception:
                    continue
        for concept, key in [("NetIncomeLoss", "net_income"), ("GrossProfit", "gross_profit")]:
            if result[key]:
                continue
            try:
                result[key] = _fetch_edgar_concept(cik, concept)
            except Exception:
                pass

    if not result["revenue"]:
        try:
            yf_facts = _fetch_yfinance_quarterly_facts(symbol)
            result["revenue"] = yf_facts["revenue"]
            result["net_income"] = result["net_income"] or yf_facts["net_income"]
            result["gross_profit"] = result["gross_profit"] or yf_facts["gross_profit"]
        except Exception:
            pass

    return result


class EarningsCalendar(BaseModel):
    next_earnings_date: Optional[str]
    eps_estimate: Optional[float]
    revenue_estimate: Optional[int]


@app.get("/assets/{symbol}/calendar", response_model=EarningsCalendar)
def get_calendar(symbol: str):
    symbol = symbol.upper().strip()
    if not TICKER_RE.match(symbol):
        raise HTTPException(status_code=400, detail="Ungültiges Ticker-Symbol")
    try:
        ticker = yf.Ticker(symbol)
        cal = ticker.calendar
        next_date = eps_est = None
        rev_est = None
        if isinstance(cal, dict):
            dates = cal.get("Earnings Date")
            if dates is not None:
                try:
                    date_list = (
                        list(dates)
                        if hasattr(dates, "__iter__") and not isinstance(dates, str)
                        else [dates]
                    )
                    for d in date_list:
                        if d is not None:
                            next_date = str(d)[:10]
                            break
                except Exception:
                    pass
            eps_est = _safe_float(cal.get("Earnings Average") or cal.get("EPS Estimate"))
            rev_raw = cal.get("Revenue Average") or cal.get("Revenue Estimate")
            rev_est = _safe_int(rev_raw)
        return EarningsCalendar(
            next_earnings_date=next_date,
            eps_estimate=eps_est,
            revenue_estimate=rev_est,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


class AnalystData(BaseModel):
    mean_target: Optional[float]
    high_target: Optional[float]
    low_target: Optional[float]
    strong_buy: int = 0
    buy: int = 0
    hold: int = 0
    sell: int = 0
    strong_sell: int = 0


@app.get("/assets/{symbol}/analyst-data", response_model=AnalystData)
def get_analyst_data(symbol: str):
    symbol = symbol.upper().strip()
    if not TICKER_RE.match(symbol):
        raise HTTPException(status_code=400, detail="Ungültiges Ticker-Symbol")

    try:
        ticker = yf.Ticker(symbol)
        mean_t = high_t = low_t = None
        strong_buy = buy = hold = sell = strong_sell = 0
        quote_summary: dict[str, Any] = {}
        try:
            quote_summary = _fetch_yahoo_quote_summary(symbol, ["financialData", "recommendationTrend"])
        except Exception:
            quote_summary = {}

        try:
            targets = ticker.analyst_price_targets
            if isinstance(targets, dict):
                mean_t = _safe_float(targets.get("mean"))
                high_t = _safe_float(targets.get("high"))
                low_t = _safe_float(targets.get("low"))
        except Exception:
            pass

        financial_data = quote_summary.get("financialData", {})
        mean_t = mean_t or _raw_float(financial_data.get("targetMeanPrice"))
        high_t = high_t or _raw_float(financial_data.get("targetHighPrice"))
        low_t = low_t or _raw_float(financial_data.get("targetLowPrice"))

        try:
            rec = ticker.recommendations_summary
            if rec is not None and not rec.empty:
                # Take most recent period (first row after sorting)
                row = rec.sort_values("period").iloc[-1].to_dict() if "period" in rec.columns else rec.iloc[0].to_dict()
                strong_buy = int(_safe_float(row.get("strongBuy", 0)) or 0)
                buy = int(_safe_float(row.get("buy", 0)) or 0)
                hold = int(_safe_float(row.get("hold", 0)) or 0)
                sell = int(_safe_float(row.get("sell", 0)) or 0)
                strong_sell = int(_safe_float(row.get("strongSell", 0)) or 0)
        except Exception:
            pass

        if strong_buy + buy + hold + sell + strong_sell == 0:
            try:
                trend = ((quote_summary.get("recommendationTrend") or {}).get("trend") or [])
                row = next((r for r in trend if r.get("period") == "0m"), trend[0] if trend else {})
                strong_buy = int(_raw_float(row.get("strongBuy")) or 0)
                buy = int(_raw_float(row.get("buy")) or 0)
                hold = int(_raw_float(row.get("hold")) or 0)
                sell = int(_raw_float(row.get("sell")) or 0)
                strong_sell = int(_raw_float(row.get("strongSell")) or 0)
            except Exception:
                pass

        if mean_t is None or high_t is None or low_t is None:
            try:
                info = ticker.info or {}
                mean_t = mean_t or _safe_float(info.get("targetMeanPrice"))
                high_t = high_t or _safe_float(info.get("targetHighPrice"))
                low_t = low_t or _safe_float(info.get("targetLowPrice"))
            except Exception:
                pass

        return AnalystData(
            mean_target=mean_t, high_target=high_t, low_target=low_t,
            strong_buy=strong_buy, buy=buy, hold=hold,
            sell=sell, strong_sell=strong_sell,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


class InsiderTrade(BaseModel):
    date: str
    name: str
    title: str
    transaction_type: str  # "buy" or "sell"
    shares: Optional[int]
    price: Optional[float]
    value: Optional[float]


class TrendPoint(BaseModel):
    date: str
    value: int  # 0–100


class InstitutionalHolder(BaseModel):
    holder: str
    pct_held: Optional[float]
    shares: Optional[int]


class InstitutionalData(BaseModel):
    pct_insider: Optional[float]
    pct_institutions: Optional[float]
    top_holders: list[InstitutionalHolder]


def _parse_form4(cik_int: str, accession: str, primary_doc: str) -> list[dict]:
    """Fetch and parse a single Form 4 XML, returning buy/sell transactions."""
    acc_nodash = accession.replace("-", "")
    url = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc_nodash}/{primary_doc}"
    req = urllib.request.Request(
        url, headers={"User-Agent": "Finanzdashboard/1.0 contact@nexthorizon-ai.com"}
    )
    with urllib.request.urlopen(req, timeout=INSIDER_FORM4_TIMEOUT_SECS) as resp:
        root = ET.fromstring(resp.read())

    # Extract owner info
    owner_name, owner_title = "", ""
    owner_el = root.find(".//reportingOwner")
    if owner_el is not None:
        name_el = owner_el.find(".//rptOwnerName")
        title_el = owner_el.find(".//officerTitle")
        is_dir = owner_el.find(".//isDirector")
        if name_el is not None and name_el.text:
            owner_name = name_el.text.strip().title()
        if title_el is not None and title_el.text:
            owner_title = title_el.text.strip()
        elif is_dir is not None and is_dir.text == "1":
            owner_title = "Director"

    trades = []
    for trans in root.findall(".//nonDerivativeTransaction"):
        code_el = trans.find(".//transactionAcquiredDisposedCode/value")
        code = code_el.text.strip() if code_el is not None and code_el.text else ""
        # P = open-market purchase, S = open-market sale (most significant signals)
        if code not in ("P", "S"):
            continue

        date_el = trans.find(".//transactionDate/value")
        shares_el = trans.find(".//transactionShares/value")
        price_el = trans.find(".//transactionPricePerShare/value")

        t_date = date_el.text.strip() if date_el is not None and date_el.text else ""
        shares = _safe_int(shares_el.text) if shares_el is not None else None
        price = _safe_float(price_el.text) if price_el is not None else None

        trades.append({
            "date": t_date,
            "name": owner_name,
            "title": owner_title,
            "transaction_type": "buy" if code == "P" else "sell",
            "shares": shares,
            "price": price,
            "value": round(shares * price, 2) if shares and price else None,
        })
    return trades


@app.get("/assets/{symbol}/insider-trades", response_model=list[InsiderTrade])
def get_insider_trades(symbol: str):
    symbol = symbol.upper().strip()
    if not TICKER_RE.match(symbol):
        raise HTTPException(status_code=400, detail="Ungültiges Ticker-Symbol")

    cik = _get_cik(symbol)
    if not cik:
        raise HTTPException(status_code=404, detail=f"Kein SEC-Eintrag für {symbol}")

    cik_int = str(int(cik))

    try:
        url = f"https://data.sec.gov/submissions/CIK{cik}.json"
        req = urllib.request.Request(
            url, headers={"User-Agent": "Finanzdashboard/1.0 contact@nexthorizon-ai.com"}
        )
        with urllib.request.urlopen(req, timeout=INSIDER_SUBMISSIONS_TIMEOUT_SECS) as resp:
            submissions = json.loads(resp.read())
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    recent = submissions.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    accessions = recent.get("accessionNumber", [])
    primary_docs = recent.get("primaryDocument", [])

    # Keep Marco bounded: Form 4 parsing is useful context, but it must never
    # consume the full analysis budget for large-cap companies with many filings.
    form4_list = [
        (accessions[i], primary_docs[i])
        for i, f in enumerate(forms)
        if f in ("4", "4/A") and i < len(accessions) and i < len(primary_docs)
    ][:INSIDER_FORM4_SCAN_LIMIT]

    all_trades: list[dict] = []
    pool = ThreadPoolExecutor(max_workers=4)
    try:
        futures = {
            pool.submit(_parse_form4, cik_int, acc, doc): (acc, doc)
            for acc, doc in form4_list
        }
        for future in as_completed(futures, timeout=INSIDER_PARSE_BUDGET_SECS):
            try:
                all_trades.extend(future.result())
            except Exception:
                continue
    except FuturesTimeoutError:
        pass
    finally:
        pool.shutdown(wait=False, cancel_futures=True)

    all_trades.sort(key=lambda t: t.get("date", ""), reverse=True)
    return all_trades[:20]


@app.get("/assets/{symbol}/trends", response_model=list[TrendPoint])
def get_trends(symbol: str):
    symbol = symbol.upper().strip()
    if not TICKER_RE.match(symbol):
        raise HTTPException(status_code=400, detail="Ungültiges Ticker-Symbol")

    # pytrends is often blocked by Google from cloud server IPs.
    # Return empty list (not an error) so the analysis still runs without trend data.
    try:
        from pytrends.request import TrendReq
        pt = TrendReq(hl="en-US", tz=0, timeout=(10, 15))
        pt.build_payload([symbol], timeframe="today 12-m", geo="US")
        df = pt.interest_over_time()

        if df is None or df.empty or symbol not in df.columns:
            return []

        return [
            TrendPoint(date=str(ts.date()), value=int(v))
            for ts, v in zip(df.index, df[symbol])
            if not math.isnan(float(v))
        ]
    except Exception:
        return []  # Graceful fallback – Google often blocks server IPs


@app.get("/assets/{symbol}/institutional", response_model=InstitutionalData)
def get_institutional(symbol: str):
    symbol = symbol.upper().strip()
    if not TICKER_RE.match(symbol):
        raise HTTPException(status_code=400, detail="Ungültiges Ticker-Symbol")

    try:
        ticker = yf.Ticker(symbol)
        pct_insider: Optional[float] = None
        pct_institutions: Optional[float] = None
        top_holders: list[dict] = []
        quote_summary: dict[str, Any] = {}
        try:
            quote_summary = _fetch_yahoo_quote_summary(symbol, ["majorHoldersBreakdown", "institutionOwnership"])
        except Exception:
            quote_summary = {}

        try:
            major = ticker.major_holders
            if major is not None and not major.empty:
                for idx_val, row in major.iterrows():
                    row_vals = list(row)
                    # Newer yfinance: index IS the label (string), single value column
                    # Older yfinance: col 0 = value, col 1 = label
                    if isinstance(idx_val, str) and any(c.isalpha() for c in idx_val):
                        label = idx_val.lower()
                        val_raw = row_vals[0] if row_vals else None
                    elif len(row_vals) >= 2:
                        label = str(row_vals[1]).lower()
                        val_raw = row_vals[0]
                    else:
                        continue
                    val = _safe_float(str(val_raw).replace("%", "").strip()) if val_raw is not None else None
                    if val is not None and val > 1:
                        val /= 100
                    if "insider" in label and "float" not in label and pct_insider is None:
                        pct_insider = val
                    elif "institution" in label and "float" not in label and pct_institutions is None:
                        pct_institutions = val
        except Exception:
            pass

        major_breakdown = quote_summary.get("majorHoldersBreakdown", {})
        pct_insider = pct_insider or _raw_float(major_breakdown.get("insidersPercentHeld"))
        pct_institutions = pct_institutions or _raw_float(major_breakdown.get("institutionsPercentHeld"))

        try:
            inst_df = ticker.institutional_holders
            if inst_df is not None and not inst_df.empty:
                for _, row in inst_df.head(5).iterrows():
                    row_dict = row.to_dict()
                    # Find holder name – try all known column variants
                    holder = ""
                    for key in ["Holder", "holder", "Name", "name", "Organization"]:
                        v = row_dict.get(key)
                        if v and str(v) not in ("nan", "None", ""):
                            holder = str(v)
                            break
                    if not holder:
                        for v in row_dict.values():
                            if isinstance(v, str) and v not in ("nan", "None", ""):
                                holder = v
                                break
                    # Find % held
                    pct = None
                    for key in ["pctHeld", "% Out", "Pct Held", "% Held", "pct_held"]:
                        if key in row_dict:
                            pct = _safe_float(row_dict[key])
                            if pct is not None:
                                break
                    # Find shares
                    shares = None
                    for key in ["Shares", "shares", "Value"]:
                        if key in row_dict:
                            s = _safe_int(row_dict[key])
                            if s and s > 0:
                                shares = s
                                break
                    if holder:
                        top_holders.append({"holder": holder, "pct_held": pct, "shares": shares})
        except Exception:
            pass

        if not top_holders:
            ownership_list = (quote_summary.get("institutionOwnership") or {}).get("ownershipList") or []
            for item in ownership_list[:5]:
                holder = item.get("organization") or item.get("name")
                if not holder:
                    continue
                top_holders.append({
                    "holder": str(holder),
                    "pct_held": _raw_float(item.get("pctHeld")),
                    "shares": _raw_int(item.get("position")),
                })

        return InstitutionalData(
            pct_insider=pct_insider,
            pct_institutions=pct_institutions,
            top_holders=top_holders,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


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
