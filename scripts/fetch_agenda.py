#!/usr/bin/env python3
"""Haalt de eerstvolgende cijferpublicatiedatums op via yfinance en schrijft
docs/data/agenda.json + werkt docs/data/changelog.json bij.

Bron: yfinance (Yahoo Finance). Enige gratis bron die de hele bedrijvenlijst dekt
(Euronext, Xetra, Londen, Korea, Japan, Taiwan). Zie README voor de afweging.

Draaien:  python scripts/fetch_agenda.py
"""

from __future__ import annotations

import json
import sys
import time
import warnings
from datetime import datetime, date, time as dtime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf

from exchanges import (
    us_session,
    TRUSTED_INTRADAY_REGIONS,
    PUBLICATION_CONVENTION,
    session_from_ams_time,
    country_for,
    yahoo_url,
)

warnings.filterwarnings("ignore")

AMS = ZoneInfo("Europe/Amsterdam")
ET = ZoneInfo("America/New_York")

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
DATA_DIR = ROOT / "docs" / "data"
COMPANIES_FILE = SCRIPT_DIR / "companies.json"
AGENDA_FILE = DATA_DIR / "agenda.json"
CHANGELOG_FILE = DATA_DIR / "changelog.json"

RETRIES = 2
SLEEP_BETWEEN = 0.4  # beleefde pauze tegen Yahoo's soft rate-limit


def load_companies() -> list[dict]:
    with open(COMPANIES_FILE, encoding="utf-8") as f:
        return json.load(f)["companies"]


def _to_ams_date(dt_utc: datetime) -> date:
    return dt_utc.astimezone(AMS).date()


def _collect_candidates(tk: yf.Ticker, today: date) -> list[dict]:
    """Verzamel kandidaat-datums uit info, get_earnings_dates en calendar.

    Elke kandidaat: {date, dt_utc|None, estimate: bool|None, has_time, source}.
    Alleen datums >= vandaag (Amsterdamse tijd) worden teruggegeven.
    """
    cands: list[dict] = []

    # 1) info.earningsTimestamp — Yahoo's canonieke 'volgende cijfers' + estimate-vlag
    try:
        info = tk.info or {}
    except Exception:
        info = {}
    ets = info.get("earningsTimestamp")
    if ets:
        dt_utc = datetime.fromtimestamp(int(ets), tz=timezone.utc)
        est = info.get("isEarningsDateEstimate")
        cands.append({
            "date": _to_ams_date(dt_utc), "dt_utc": dt_utc,
            "estimate": est if isinstance(est, bool) else None,
            "has_time": True, "source": "info",
        })

    # 2) get_earnings_dates — tabel met (geschatte) datums
    try:
        ed = tk.get_earnings_dates(limit=16)
    except Exception:
        ed = None
    if ed is not None and len(ed):
        for idx in ed.index:
            ts = idx.to_pydatetime()
            dt_utc = ts.astimezone(timezone.utc)
            cands.append({
                "date": _to_ams_date(dt_utc), "dt_utc": dt_utc,
                "estimate": None, "has_time": True, "source": "earnings_dates",
            })

    # 3) calendar — soms een datum die de andere twee missen (bv. Volkswagen)
    try:
        cal = tk.calendar
    except Exception:
        cal = None
    cal_dates = []
    if isinstance(cal, dict):
        val = cal.get("Earnings Date")
        if isinstance(val, list):
            cal_dates = val
        elif val is not None:
            cal_dates = [val]
    for d in cal_dates:
        if isinstance(d, datetime):
            d = d.date()
        if isinstance(d, date):
            cands.append({
                "date": d, "dt_utc": None,
                "estimate": None, "has_time": False, "source": "calendar",
            })

    return [c for c in cands if c["date"] >= today]


SOURCE_PRIORITY = {"info": 0, "earnings_dates": 1, "calendar": 2}


def resolve_next(tk: yf.Ticker, region: str, today: date) -> dict | None:
    cands = _collect_candidates(tk, today)
    if not cands:
        return None

    earliest = min(c["date"] for c in cands)
    same_day = [c for c in cands if c["date"] == earliest]
    same_day.sort(key=lambda c: SOURCE_PRIORITY[c["source"]])
    chosen = same_day[0]

    # Estimate-vlag: alleen betrouwbaar als de info-kandidaat op dezelfde dag valt.
    estimate = next((c["estimate"] for c in same_day if c["estimate"] is not None), None)
    status = "bevestigd" if estimate is False else "verwacht"

    time_known = False
    session = "onbekend"
    next_datetime_ams = None
    time_source = None

    if region in TRUSTED_INTRADAY_REGIONS and chosen["has_time"] and chosen["dt_utc"]:
        et_dt = chosen["dt_utc"].astimezone(ET)
        session = us_session(et_dt)
        ams_dt = chosen["dt_utc"].astimezone(AMS)
        next_datetime_ams = ams_dt.isoformat()
        time_known = True
        time_source = "yahoo"

    return {
        "next_date": earliest.isoformat(),
        "next_datetime_ams": next_datetime_ams,
        "time_known": time_known,
        "session": session,
        "status": status,
        "time_source": time_source,
    }


def _parse_hhmm(value) -> tuple[int, int] | None:
    """Parse 'HH:MM' (Amsterdamse tijd) uit een override; None als ongeldig."""
    try:
        hh, mm = str(value).strip().split(":")
        hh, mm = int(hh), int(mm)
        if 0 <= hh < 24 and 0 <= mm < 60:
            return hh, mm
    except (ValueError, AttributeError):
        pass
    return None


def apply_time_fallback(result: dict | None, company: dict, country: str | None) -> dict | None:
    """Vul sessie + tijd aan als yfinance geen betrouwbare intraday-tijd gaf.

    Prioriteit: (1) per-bedrijf override, (2) landconventie. Muteert en retourneert
    het result. Doet niets als er al een betrouwbare tijd is (US intraday) of als er
    (nog) geen datum is.
    """
    if not result or not result.get("next_date") or result.get("time_known"):
        return result

    d = date.fromisoformat(result["next_date"])

    # 1) Handmatige override (Amsterdamse tijd) — gezaghebbend.
    hhmm = _parse_hhmm(company.get("time_override"))
    if hhmm:
        ams_dt = datetime.combine(d, dtime(hhmm[0], hhmm[1]), tzinfo=AMS)
        result["next_datetime_ams"] = ams_dt.isoformat()
        result["time_known"] = True
        result["time_source"] = "override"
        result["session"] = company.get("session_override") or session_from_ams_time(ams_dt.time())
        return result

    # 2) Landconventie (continentaal Europa ~07:00 lokaal voorbeurs, Londen 07:00 GMT).
    conv = PUBLICATION_CONVENTION.get(country)
    if conv:
        hh, mm, tzname, sess = conv
        local_dt = datetime.combine(d, dtime(hh, mm), tzinfo=ZoneInfo(tzname))
        ams_dt = local_dt.astimezone(AMS)
        result["next_datetime_ams"] = ams_dt.isoformat()
        result["time_known"] = True
        result["time_source"] = "convention"
        result["session"] = company.get("session_override") or sess

    return result


def build_entry(company: dict, today: date, now_iso: str) -> dict:
    base = {
        "name": company["name"],
        "yahoo_ticker": company.get("ticker"),
        "exchange": company.get("exchange", ""),
        "region": company.get("region", ""),
        "country": country_for(company),
        "source_url": yahoo_url(company.get("ticker")),
        "next_date": None,
        "next_datetime_ams": None,
        "time_known": False,
        "time_source": None,
        "session": "onbekend",
        "status": None,
        "manual": bool(company.get("manual")),
        "note": company.get("note"),
        "changed_since_yesterday": False,
        "previous_date": None,
        "fetched_at": now_iso,
    }

    if company.get("manual") or not company.get("ticker"):
        base["manual"] = True
        return base

    result = None
    for attempt in range(RETRIES):
        try:
            tk = yf.Ticker(company["ticker"])
            result = resolve_next(tk, company.get("region", ""), today)
            break
        except Exception as e:  # netwerk/rate-limit — kort opnieuw proberen
            if attempt == RETRIES - 1:
                print(f"  ! {company['name']} ({company['ticker']}): {type(e).__name__}: {e}",
                      file=sys.stderr)
            else:
                time.sleep(1.5)

    # Tijd/sessie aanvullen uit override of landconventie als yfinance niets
    # betrouwbaars intraday gaf (alle niet-US-namen).
    result = apply_time_fallback(result, company, base["country"])

    if result:
        base.update(result)
    return base


def load_previous_dates() -> dict[str, str | None]:
    if not AGENDA_FILE.exists():
        return {}
    try:
        with open(AGENDA_FILE, encoding="utf-8") as f:
            prev = json.load(f)
        return {c["name"]: c.get("next_date") for c in prev.get("companies", [])}
    except Exception:
        return {}


def apply_diff(entries: list[dict], prev_dates: dict, run_date: str) -> list[dict]:
    changes = []
    for e in entries:
        prev = prev_dates.get(e["name"])
        new = e["next_date"]
        if prev and new and prev != new:
            e["changed_since_yesterday"] = True
            e["previous_date"] = prev
            changes.append({"run_date": run_date, "name": e["name"],
                            "from": prev, "to": new})
        elif e["name"] not in prev_dates and new:
            # nieuw in de agenda (eerste keer een datum) — loggen, geen badge
            changes.append({"run_date": run_date, "name": e["name"],
                            "from": None, "to": new})
    return changes


def append_changelog(changes: list[dict]) -> None:
    log = []
    if CHANGELOG_FILE.exists():
        try:
            with open(CHANGELOG_FILE, encoding="utf-8") as f:
                log = json.load(f)
        except Exception:
            log = []
    log.extend(changes)
    log = log[-500:]  # rollend, laatste 500 wijzigingen
    with open(CHANGELOG_FILE, "w", encoding="utf-8") as f:
        json.dump(log, f, ensure_ascii=False, indent=2)


def main() -> int:
    companies = load_companies()
    now = datetime.now(AMS)
    today = now.date()
    now_iso = now.isoformat(timespec="seconds")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    prev_dates = load_previous_dates()

    entries = []
    print(f"Ophalen van {len(companies)} bedrijven via yfinance...")
    for c in companies:
        entry = build_entry(c, today, now_iso)
        entries.append(entry)
        if not entry["manual"]:
            time.sleep(SLEEP_BETWEEN)
        label = entry["next_date"] or ("handmatig / n.v.t." if entry["manual"] else "geen datum")
        print(f"  {entry['name']:34} {label}  [{entry['session']}]")

    # Sorteer: bedrijven met datum eerst (op datum), daarna zonder datum, dan handmatig.
    def sort_key(e):
        if e["manual"]:
            return (2, "", e["name"])
        if not e["next_date"]:
            return (1, "", e["name"])
        return (0, e["next_date"], e["name"])
    entries.sort(key=sort_key)

    changes = apply_diff(entries, prev_dates, today.isoformat())
    if changes:
        append_changelog(changes)
        print(f"\n{len(changes)} wijziging(en) gelogd.")

    payload = {"generated_at": now_iso, "companies": entries}
    with open(AGENDA_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    with_date = sum(1 for e in entries if e["next_date"])
    print(f"\nGeschreven: {AGENDA_FILE}")
    print(f"  {with_date}/{len(entries)} met datum, "
          f"{sum(1 for e in entries if e['manual'])} handmatig, "
          f"{sum(1 for e in entries if not e['next_date'] and not e['manual'])} zonder datum.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
