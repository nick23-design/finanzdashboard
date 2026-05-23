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
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Optional

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

TICKER_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")


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


# ── ISIN helpers ─────────────────────────────────────────────────────────────

_isin_cache: dict[str, str] = {}  # symbol → ISIN; survives for process lifetime


def _extract_isin(candidate) -> Optional[str]:
    if candidate and str(candidate).strip().upper() not in ("NONE", "N/A", ""):
        return str(candidate).strip()
    return None


def _fetch_isin_eodhd(symbol: str) -> Optional[str]:
    """Primary ISIN source: EODHD fundamentals API (free tier, 20 calls/day).
    Results are cached in-process so each symbol is only fetched once.
    Exchange mapping: bare ticker → .US, suffix .DE → .XETRA."""
    api_key = os.getenv("EODHD_API_KEY")
    if not api_key:
        return None

    if "." in symbol:
        base, suffix = symbol.rsplit(".", 1)
        eodhd_sym = f"{base}.XETRA" if suffix == "DE" else symbol
    else:
        eodhd_sym = f"{symbol}.US"

    if eodhd_sym in _isin_cache:
        return _isin_cache[eodhd_sym]

    try:
        url = (
            f"https://eodhd.com/api/fundamentals/{urllib.parse.quote(eodhd_sym)}"
            f"?api_token={api_key}&filter=General::ISIN"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=8) as r:
            raw = r.read().decode().strip().strip('"')
        isin = _extract_isin(raw)
        if isin:
            _isin_cache[eodhd_sym] = isin
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
            name = item.get("longname") or item.get("shortname") or symbol
            if symbol:
                results.append(SearchResult(
                    symbol=symbol,
                    name=name,
                    exchange=item.get("exchange"),
                    type=item.get("quoteType"),
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


@app.get("/debug/isin/{symbol}")
def debug_isin(symbol: str):
    """Diagnostic endpoint – shows raw responses from each ISIN source."""
    symbol = symbol.upper().strip()
    api_key = os.getenv("EODHD_API_KEY")
    result: dict = {"symbol": symbol, "eodhd_key_set": bool(api_key)}

    if api_key:
        # Show raw response from fundamentals endpoint
        try:
            url = (
                f"https://eodhd.com/api/fundamentals/{urllib.parse.quote(symbol)}.US"
                f"?api_token={api_key}&filter=General::ISIN"
            )
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=8) as r:
                result["eodhd_fundamentals_raw"] = r.read().decode()[:300]
        except Exception as e:
            result["eodhd_fundamentals_error"] = str(e)

        # Show raw response from search endpoint (may include ISIN on free tier)
        try:
            url = f"https://eodhd.com/api/search/{urllib.parse.quote(symbol)}?api_token={api_key}&limit=3"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=8) as r:
                result["eodhd_search_raw"] = json.loads(r.read())
        except Exception as e:
            result["eodhd_search_error"] = str(e)

    return result


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

        return AssetResponse(
            symbol=symbol,
            name=info.get("longName") or info.get("shortName") or symbol,
            price=last_price,
            currency=info.get("currency", "USD"),
            isin=isin,
            description=description,
            pe_ratio=_safe_float(info.get("trailingPE") or info.get("forwardPE")),
            market_cap=_safe_int(info.get("marketCap")),
            debt_to_equity=_safe_float(info.get("debtToEquity")),
            revenue_growth=_safe_float(info.get("revenueGrowth")),
            free_cashflow=_safe_int(info.get("freeCashflow")),
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
    try:
        return _load_cik_map().get(ticker.upper())
    except Exception:
        return None


def _fetch_edgar_concept(cik: str, concept: str, max_items: int = 8) -> list[dict]:
    url = f"https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/us-gaap/{concept}.json"
    req = urllib.request.Request(
        url, headers={"User-Agent": "Finanzdashboard/1.0 contact@nexthorizon-ai.com"}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
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

    for concept in ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"]:
        try:
            result["revenue"] = _fetch_edgar_concept(cik, concept)
            break
        except Exception:
            continue

    for concept, key in [("NetIncomeLoss", "net_income"), ("GrossProfit", "gross_profit")]:
        try:
            result[key] = _fetch_edgar_concept(cik, concept)
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

        try:
            targets = ticker.analyst_price_targets
            if isinstance(targets, dict):
                mean_t = _safe_float(targets.get("mean"))
                high_t = _safe_float(targets.get("high"))
                low_t = _safe_float(targets.get("low"))
        except Exception:
            pass

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
    with urllib.request.urlopen(req, timeout=8) as resp:
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
        with urllib.request.urlopen(req, timeout=10) as resp:
            submissions = json.loads(resp.read())
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    recent = submissions.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    accessions = recent.get("accessionNumber", [])
    primary_docs = recent.get("primaryDocument", [])

    # Scan up to 30 most recent Form 4 filings (executives at large firms file many
    # non-P/S transactions like grants and option exercises before an open-market trade)
    form4_list = [
        (accessions[i], primary_docs[i])
        for i, f in enumerate(forms)
        if f in ("4", "4/A") and i < len(accessions) and i < len(primary_docs)
    ][:30]

    all_trades: list[dict] = []
    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {
            pool.submit(_parse_form4, cik_int, acc, doc): (acc, doc)
            for acc, doc in form4_list
        }
        for future in as_completed(futures):
            try:
                all_trades.extend(future.result())
            except Exception:
                continue

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
