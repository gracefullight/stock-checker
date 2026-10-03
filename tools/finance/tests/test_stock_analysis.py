import asyncio
from types import SimpleNamespace
from typing import Literal, Never
from unittest.mock import PropertyMock, patch

import analyze_stock as stock
import pandas as pd
import pytest
import yfinance as yf


def _block_network(*args: object, **kwargs: object) -> Never:
    pytest.fail("Stock analysis regression tests must not access the network")


@pytest.fixture(autouse=True)
def block_network(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("socket.create_connection", _block_network)
    monkeypatch.setattr("socket.socket.connect", _block_network)
    monkeypatch.setattr("socket.socket.connect_ex", _block_network)
    monkeypatch.setattr("curl_cffi.requests.Session.request", _block_network)


@pytest.fixture
def ticker() -> yf.Ticker:
    return yf.Ticker("OFFLINE")


def test_fetch_stock_data_preserves_ticker_for_option_analysis(ticker: yf.Ticker) -> None:
    history = pd.DataFrame(
        {"Open": [100.0], "Close": [102.0], "Volume": [20.0]},
        index=pd.to_datetime(["2025-04-01"]),
    )
    with (
        patch.object(yf, "Ticker", return_value=ticker),
        patch.object(type(ticker), "info", new_callable=PropertyMock,
                     return_value={"regularMarketPrice": 102.0}),
        patch.object(type(ticker), "earnings_dates", new_callable=PropertyMock, return_value=None),
        patch.object(type(ticker), "recommendations", new_callable=PropertyMock, return_value=None),
        patch.object(type(ticker), "analyst_price_targets", new_callable=PropertyMock, return_value=None),
        patch.object(ticker, "history", return_value=history) as history_request,
    ):
        data = stock.fetch_stock_data("OFFLINE")

    assert data is not None
    assert data.ticker_obj is ticker
    assert data.price_history is history
    history_request.assert_called_once_with(period="1y")


def test_put_call_ratio_uses_nearest_expiration_and_contrarian_score(ticker: yf.Ticker) -> None:
    data = stock.StockData("OFFLINE", {}, None, None, None, ticker_obj=ticker)
    chain = SimpleNamespace(
        puts=pd.DataFrame({"volume": [30, 10]}),
        calls=pd.DataFrame({"volume": [10, 10]}),
    )
    with (
        patch.object(type(ticker), "options", new_callable=PropertyMock,
                     return_value=("2026-10-16", "2026-11-20")),
        patch.object(ticker, "option_chain", return_value=chain) as chain_request,
    ):
        result = asyncio.run(stock.get_put_call_ratio(data))

    assert result == (0.3, 2.0, 40, 20)
    chain_request.assert_called_once_with("2026-10-16")


@pytest.mark.parametrize("expirations", [None, ()], ids=["unknown", "empty"])
def test_put_call_ratio_without_expirations_skips_chain_request(
    ticker: yf.Ticker, expirations: tuple[str, ...] | None
) -> None:
    data = stock.StockData("OFFLINE", {}, None, None, None, ticker_obj=ticker)
    with (
        patch.object(type(ticker), "options", new_callable=PropertyMock, return_value=expirations),
        patch.object(ticker, "option_chain") as chain_request,
    ):
        assert asyncio.run(stock.get_put_call_ratio(data)) is None
        chain_request.assert_not_called()


@pytest.mark.parametrize("missing", ["ticker", "chain"])
def test_put_call_ratio_with_missing_optional_data_returns_none(
    ticker: yf.Ticker, missing: Literal["ticker", "chain"]
) -> None:
    data = stock.StockData("OFFLINE", {}, None, None, None)
    if missing == "chain":
        data.ticker_obj = ticker
    with (
        patch.object(type(ticker), "options", new_callable=PropertyMock,
                     return_value=("2026-10-16",)),
        patch.object(ticker, "option_chain", return_value=None) as chain_request,
    ):
        assert asyncio.run(stock.get_put_call_ratio(data)) is None
        if missing == "ticker":
            chain_request.assert_not_called()
        else:
            chain_request.assert_called_once_with("2026-10-16")
