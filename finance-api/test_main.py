"""
Tests for Finance API helpers.
Run: python -m pytest finance-api/test_main.py -v
"""
import math
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from main import _safe_float, _safe_int, _compute_rsi, TICKER_RE


class TestSafeFloat:
    def test_normal_float(self):
        assert _safe_float(3.14) == 3.14

    def test_none_returns_none(self):
        assert _safe_float(None) is None

    def test_nan_returns_none(self):
        assert _safe_float(float("nan")) is None

    def test_inf_returns_none(self):
        assert _safe_float(float("inf")) is None

    def test_string_number(self):
        assert _safe_float("42.5") == 42.5

    def test_invalid_string(self):
        assert _safe_float("abc") is None


class TestSafeInt:
    def test_positive(self):
        assert _safe_int(100.7) == 100

    def test_none(self):
        assert _safe_int(None) is None

    def test_nan(self):
        assert _safe_int(float("nan")) is None


class TestComputeRsi:
    def _make_prices(self, n=20, trend="up"):
        if trend == "up":
            return [100 + i for i in range(n)]
        if trend == "down":
            return [100 - i for i in range(n)]
        return [100.0] * n

    def test_insufficient_data_returns_none(self):
        assert _compute_rsi([1, 2, 3], period=14) is None

    def test_strong_uptrend_rsi_high(self):
        prices = self._make_prices(30, "up")
        rsi = _compute_rsi(prices, period=14)
        assert rsi is not None
        assert rsi > 70

    def test_strong_downtrend_rsi_low(self):
        prices = self._make_prices(30, "down")
        rsi = _compute_rsi(prices, period=14)
        assert rsi is not None
        assert rsi < 30

    def test_flat_market(self):
        prices = self._make_prices(30, "flat")
        rsi = _compute_rsi(prices, period=14)
        # No gains or losses — avg_loss = 0, result is 100
        assert rsi == 100.0

    def test_rsi_within_bounds(self):
        import random
        random.seed(42)
        prices = [100 + random.uniform(-5, 5) for _ in range(50)]
        rsi = _compute_rsi(prices, period=14)
        assert rsi is not None
        assert 0 <= rsi <= 100


class TestTickerRegex:
    def test_valid_tickers(self):
        valid = ["AAPL", "MSFT", "SAP.DE", "BRK-B", "NESN.SW", "A"]
        for t in valid:
            assert TICKER_RE.match(t), f"Should match: {t}"

    def test_invalid_tickers(self):
        # 31 chars exceeds the {1,30} limit. The cap is intentionally generous to
        # leave room for suffixes like SAP.DE / BRK-B / NESN.SW.
        invalid = ["", "A" * 31, "AA PL", "AAPL!", "aa pl"]
        for t in invalid:
            assert not TICKER_RE.match(t), f"Should not match: {t}"
