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
            title = title_el.text if title_el is not None else ""
            if title:
                items.append(GoogleNewsItem(
                    title=title,
                    source=source_el.text if source_el is not None else "",
                    published=pub_el.text if pub_el is not None else None,
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

    # Collect the 5 most recent Form 4 filings
    form4_list = [
        (accessions[i], primary_docs[i])
        for i, f in enumerate(forms)
        if f in ("4", "4/A") and i < len(accessions) and i < len(primary_docs)
    ][:5]

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
    except ImportError:
        raise HTTPException(status_code=503, detail="pytrends nicht installiert")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


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
                for _, row in major.iterrows():
                    row_vals = list(row)
                    if len(row_vals) < 2:
                        continue
                    label = str(row_vals[1]).lower()
                    val = _safe_float(str(row_vals[0]).replace("%", "").strip())
                    if val is not None and val > 1:
                        val /= 100  # convert from percent to fraction
                    if "insider" in label and pct_insider is None:
                        pct_insider = val
                    elif "institution" in label and "float" not in label and pct_institutions is None:
                        pct_institutions = val
        except Exception:
            pass

        try:
            inst_df = ticker.institutional_holders
            if inst_df is not None and not inst_df.empty:
                col_map = {c.lower().replace(" ", "_"): c for c in inst_df.columns}
                for _, row in inst_df.head(5).iterrows():
                    holder = str(row.get(col_map.get("holder", "Holder"), row.iloc[1] if len(row) > 1 else ""))
                    pct_col = col_map.get("pctheld", col_map.get("%_out", None))
                    pct = _safe_float(row.get(pct_col)) if pct_col else None
                    shares_col = col_map.get("shares", None)
                    shares = _safe_int(row.get(shares_col)) if shares_col else None
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
