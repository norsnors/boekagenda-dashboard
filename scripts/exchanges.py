"""Beursconfiguratie voor het afleiden van voorbeurs/nabeurs.

yfinance geeft alle earnings-tijdstempels terug in America/New_York. Voor
US-noteringen is dat het echte event-tijdstip, dus daar kunnen we betrouwbaar
voorbeurs/nabeurs afleiden uit de beursuren. Voor niet-US-noteringen is het
intraday-tijdstip bij Yahoo een placeholder (vrijwel altijd 11:00 ET voor Europa),
dus daar leiden we GEEN sessie af en tonen we alleen de datum.

Wil je later toch harde tijden voor bijv. Euronext toevoegen (via een betaalde bron
of IR-scrape)? Dan breid je MARKET_HOURS uit en pas je session_for_region() aan.
"""

from datetime import time

# Beursuren in de LOKALE tijdzone van de beurs.
MARKET_HOURS = {
    "US": {"tz": "America/New_York", "open": time(9, 30), "close": time(16, 0)},
    # Referentie voor toekomstige uitbreiding (nu niet gebruikt voor sessie-afleiding):
    # "NL": {"tz": "Europe/Amsterdam", "open": time(9, 0), "close": time(17, 40)},
    # "EU": {"tz": "Europe/Amsterdam", "open": time(9, 0), "close": time(17, 30)},
    # "ASIA": handmatig per beurs (KRX/TSE/TWSE verschillen).
}

# Regio's waarvan we het intraday-tijdstip vertrouwen voor sessie-afleiding.
TRUSTED_INTRADAY_REGIONS = {"US"}

REGION_LABELS = {
    "NL": "Nederland",
    "EU": "Europa",
    "US": "VS",
    "ASIA": "Azië",
}


def us_session(et_dt):
    """Bepaal sessie uit een America/New_York-tijdstip (US-noteringen).

    Retourneert 'voorbeurs', 'tijdens handel' of 'nabeurs'.
    """
    hours = MARKET_HOURS["US"]
    t = et_dt.time()
    if t < hours["open"]:
        return "voorbeurs"
    if t >= hours["close"]:
        return "nabeurs"
    return "tijdens handel"


# ---------------------------------------------------------------------------
# Land-afleiding (voor de vlaggetjes in het dashboard).
#
# Deze twee maps worden gespiegeld in docs/app.js (COUNTRY + suffix-map). Houd
# ze in sync als je een beurs/land toevoegt. Beurs-naam is de eerste keus;
# valt die niet te matchen, dan de Yahoo-tickersuffix; anders de regio.
# ---------------------------------------------------------------------------
EXCHANGE_COUNTRY = {
    "Euronext Amsterdam": "NL",
    "Euronext Paris": "FR",
    "Euronext Brussel": "BE",
    "London Stock Exchange": "GB",
    "Frankfurt (Xetra)": "DE",
    "Nasdaq": "US",
    "NYSE": "US",
    "Korea Exchange (KRX)": "KR",
    "Nasdaq Copenhagen": "DK",
    "Tokyo (TSE)": "JP",
    "Taiwan (TWSE)": "TW",
}

# Yahoo-tickersuffix -> ISO-landcode (fallback als de beurs onbekend is).
SUFFIX_COUNTRY = {
    "AS": "NL", "PA": "FR", "BR": "BE", "L": "GB", "DE": "DE",
    "KS": "KR", "CO": "DK", "T": "JP", "TW": "TW", "MI": "IT",
    "MC": "ES", "SW": "CH", "ST": "SE", "HE": "FI", "OL": "NO",
    "VI": "AT", "LS": "PT", "IR": "IE", "HK": "HK",
}

# Regio -> representatieve landcode als laatste redmiddel.
REGION_COUNTRY = {"NL": "NL", "US": "US"}


def country_for(company: dict) -> str | None:
    """Leid de ISO-2 landcode af uit beurs, ticker of regio."""
    exch = (company.get("exchange") or "").strip()
    if exch in EXCHANGE_COUNTRY:
        return EXCHANGE_COUNTRY[exch]
    ticker = company.get("ticker") or ""
    if "." in ticker:
        suffix = ticker.rsplit(".", 1)[1].upper()
        if suffix in SUFFIX_COUNTRY:
            return SUFFIX_COUNTRY[suffix]
    elif ticker:  # geen suffix = Amerikaanse notering bij Yahoo
        return "US"
    return REGION_COUNTRY.get(company.get("region", ""))


def yahoo_url(ticker: str | None) -> str | None:
    """Publieke Yahoo Finance-pagina van een ticker (voor bronverificatie)."""
    if not ticker:
        return None
    return f"https://finance.yahoo.com/quote/{ticker}"
