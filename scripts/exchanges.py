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

# ---------------------------------------------------------------------------
# Gebruikelijke publicatietijd van kwartaal-/jaarcijfers per land (LOKALE
# beurstijd). Continentaal-Europese beursfondsen publiceren hun persbericht
# vrijwel altijd rond 07:00 lokale tijd vóór opening; Londen doorgaans 07:00 GMT
# (= 08:00 Amsterdam). Dit is een CONVENTIE, geen per-bedrijf bevestigde tijd:
# de fetcher zet time_source="convention" zodat het dashboard zo'n tijd zichtbaar
# als "gebruikelijk" toont i.p.v. als hard bevestigd. Klopt een tijd niet? Zet
# 'm dan per bedrijf via "time_override" (+ evt. "session_override") in
# companies.json — die override wint altijd.
#
# Azië (KR/JP/TW) staat er bewust NIET in: publicatietijden lopen daar te veel
# uiteen om een betrouwbare conventie te hebben. Die blijven "tijd onbekend"
# tenzij je ze per bedrijf met een override invult.
# country -> (uur, minuut, IANA-tz, sessie)
PUBLICATION_CONVENTION = {
    "NL": (7, 0, "Europe/Amsterdam", "voorbeurs"),
    "FR": (7, 0, "Europe/Paris", "voorbeurs"),
    "BE": (7, 0, "Europe/Brussels", "voorbeurs"),
    "DE": (7, 0, "Europe/Berlin", "voorbeurs"),
    "DK": (7, 0, "Europe/Copenhagen", "voorbeurs"),
    "GB": (7, 0, "Europe/London", "voorbeurs"),
}


def session_from_ams_time(t):
    """Grove sessie-indeling o.b.v. een Amsterdamse kloktijd (datetime.time).

    Voor overrides die wél een tijd maar geen expliciete sessie meegeven.
    Euronext Amsterdam-uren (09:00–17:40) als referentie.
    """
    if t < time(9, 0):
        return "voorbeurs"
    if t >= time(17, 40):
        return "nabeurs"
    return "tijdens handel"

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
