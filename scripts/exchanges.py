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
