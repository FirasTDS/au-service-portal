#!/usr/bin/env python3
"""Fetch the USD/SYP buy/sell rate (Damascus) from sp-today.com and write rates.json.

Scraping logic ported from sp-today.py (frappe_docker): sp-today publishes new-SYP
prices in server-rendered HTML plus a Next.js flight payload with per-city
old-SYP integers, e.g. \"damascus\":{\"buy\":13850,\"sell\":13925}. We decode a
flight packet, match the USD currency object and its Damascus entry only (never
another city, never conversion-table numbers), and convert old->new SYP.

Stdlib only so GitHub Actions can run it without installing dependencies.
Usage: python scripts/update-rates.py [--out rates.json] [--check]
  --check prints the rates without writing (used for local verification).
Exit code is non-zero when any currency cannot be fetched or validated, so a
scheduled job never commits partial or garbage data.
"""

import argparse
import datetime
import json
import re
import math
from pathlib import Path
import sys
import urllib.request

BASE_URL = "https://sp-today.com/currency"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}
TIMEOUT = 25

# Only SYP->USD is published. Range is a sanity check in NEW SYP, not a prediction.
CURRENCIES = {
    "USD": ("us-dollar", 20.0, 500.0),
}

FLIGHT_RE = re.compile(r'self\.__next_f\.push\((\[.*?\])\)\s*;?\s*</script>', re.S)


def fetch_html(slug):
    req = urllib.request.Request(f"{BASE_URL}/{slug}", headers=HEADERS)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
        if res.status != 200:
            raise RuntimeError(f"HTTP {res.status} for {slug}")
        return res.read().decode("utf-8", errors="replace")


def parse_city_rate(html, code):
    """Decode flight JSON, then match the requested currency and Damascus only.

    Never guess numbers from conversion tables or silently substitute another city.
    The source's cities payload uses OLD SYP; visible cards use NEW SYP.
    """
    decoder = json.JSONDecoder()
    for match in FLIGHT_RE.finditer(html):
        try:
            packet = json.loads(match.group(1))
        except (ValueError, TypeError):
            continue
        if len(packet) < 2 or packet[0] != 1 or not isinstance(packet[1], str):
            continue
        for currency_match in re.finditer(r'"currency"\s*:\s*', packet[1]):
            try:
                currency, _ = decoder.raw_decode(packet[1][currency_match.end():])
                if not isinstance(currency, dict) or currency.get('code') != code:
                    continue
                city = currency['cities']['damascus']
                buy, sell = city['buy'], city['sell']
                if any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0 for v in (buy, sell)):
                    continue
                if buy > sell:
                    continue
                return round(buy / 100, 2), round(sell / 100, 2)
            except (ValueError, TypeError, KeyError):
                continue
    return None


def collect_rates():
    rates = {}
    for code, (slug, low, high) in CURRENCIES.items():
        html = fetch_html(slug)
        parsed = parse_city_rate(html, code)
        if not parsed:
            raise RuntimeError(f"could not parse {code} rate from {slug}")
        buy, sell = parsed
        if not (low <= buy <= high and low <= sell <= high):
            raise RuntimeError(f"{code} out of range: buy={buy} sell={sell}")
        rates[code] = {"buy": buy, "sell": sell}
    return rates


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="rates.json")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    rates = collect_rates()
    payload = {
        "fetched_at": datetime.datetime.now(datetime.timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        ),
        "source": "sp-today.com",
        "city": "دمشق",
        "unit": "SYP_NEW",
        "rates": rates,
    }
    if args.check:
        print(json.dumps(payload, ensure_ascii=True, indent=2))
        return 0
    target = Path(args.out)
    temporary = target.with_suffix('.tmp')
    with temporary.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    temporary.replace(target)
    print(f"wrote {args.out}: " + ", ".join(
        f"1 {code}={v['buy']}/{v['sell']}" for code, v in rates.items()
    ))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - surface any failure to the scheduler
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
