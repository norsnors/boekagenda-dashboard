# Cijferagenda — BNR redactie

Een webdashboard dat voor een vaste lijst beursgenoteerde bedrijven toont **wanneer** ze hun
kwartaal- of jaarcijfers publiceren (datum + tijd in Amsterdamse tijd + voorbeurs/nabeurs).
Het werkt zichzelf elke werkdag automatisch bij; niemand op de redactie hoeft er handmatig
iets in bij te werken.

- **Frontend:** statische pagina in [`docs/`](docs/) (plain HTML/CSS/JS, geen framework).
- **Data:** één JSON-bestand [`docs/data/agenda.json`](docs/data/agenda.json), opgehaald door
  een klein Python-script.
- **Auto-update:** GitHub Actions cron (elke werkdag ~06:00 NL) → commit → GitHub Pages.
- De browser doet **geen** API-calls: geen keys in de client, geen rate-limits voor bezoekers.

```
scripts/fetch_agenda.py  ──>  docs/data/agenda.json  ──>  docs/index.html (leest de JSON)
   (GitHub Actions, dagelijks)                              (GitHub Pages)
```

---

## Databron: waarom yfinance?

De opdracht gaf als voorkeur Financial Modeling Prep (FMP) → Finnhub → yfinance. Bij het
evalueren bleek echter:

| Bron | Gratis dekking | Geschikt voor deze lijst? |
|---|---|---|
| **FMP** (gratis) | Alleen **US**-aandelen (EOD-sandbox) | Nee — dekt ~9 van de 53 namen |
| **Finnhub** (gratis) | Alleen **US**-aandelen | Nee — idem |
| **yfinance** (Yahoo) | Wereldwijd, geen key | **Ja — dekt de hele lijst** |

Onze lijst is vooral Euronext Amsterdam plus Frankfurt, Londen, Parijs, Korea, Japan en Taiwan.
Die vallen buiten de gratis US-only dekking van FMP en Finnhub. In een test gaf **yfinance** voor
alle beurzen wél echte toekomstige datums terug. Daarom is de keuze: **yfinance als enige bron**,
zonder API-key.

**Tijdzone & voor-/nabeurs.** yfinance geeft alle tijdstempels terug in `America/New_York`.
- Voor **Amerikaanse** noteringen is dat het echte event-tijdstip → we rekenen om naar
  Amsterdamse tijd en leiden **voorbeurs/nabeurs** af uit de beursuren (bv. Tesla 16:00 ET =
  22:00 NL = *nabeurs*).
- Voor **niet-Amerikaanse** noteringen is het intraday-tijdstip bij Yahoo een placeholder en dus
  onbetrouwbaar. Daar tonen we de **datum** hard en de tijd als **"tijd onbekend"** — eerlijk in
  plaats van schijnzekerheid.

**Bevestigd vs. verwacht.** Afgeleid uit Yahoo's `isEarningsDateEstimate`-vlag. Verwachte
(nog niet bevestigde) datums krijgen een grijs/schuin uiterlijk + label **"verwacht"**.

### Later een tweede bron toevoegen (optioneel)

Wil je de Amerikaanse namen extra kruisverifiëren met FMP of Finnhub? Kopieer dan
[`.env.example`](.env.example) naar `.env`, vul de key(s) in, en breid `fetch_agenda.py` uit met
een verrijkingsstap voor `region == "US"`. Voor GitHub Actions zet je de keys als
**repository secrets** (Settings → Secrets and variables → Actions) en geef je ze door als `env:`
in de workflow. De huidige versie heeft dit niet nodig.

---

## Een bedrijf toevoegen of verwijderen

Alles staat in één bestand: [`scripts/companies.json`](scripts/companies.json). Voeg een object
toe of haal het weg:

```json
{ "name": "Bedrijfsnaam", "ticker": "XXXX.AS", "exchange": "Euronext Amsterdam", "region": "NL" }
```

> **Via het dashboard.** Op het dashboard staat rechtsboven de knop **“+ Bedrijf toevoegen”**.
> Vul naam, Yahoo-ticker, beurs en regio in (het herkende land toont het tijdens het typen). Er zijn
> twee modi, afhankelijk van of de toevoeg-Worker is ingesteld:
>
> - **Automatisch** (aanbevolen): met een ingestelde Cloudflare Worker klikt de redacteur op
>   **Toevoegen** en wordt het bedrijf automatisch gecommit — het verschijnt binnen enkele minuten,
>   zonder GitHub-account. Eenmalige setup: zie [`worker/README.md`](worker/README.md). Zet daarna de
>   Worker-URL in `ADD_WORKER_URL` boven in [`docs/app.js`](docs/app.js).
> - **Terugval** (zolang `ADD_WORKER_URL` leeg is): het formulier geeft de kant-en-klare JSON-regel
>   plus een knop die `scripts/companies.json` in de GitHub-editor opent — plakken en committen.

- **`ticker`** — de **Yahoo Finance**-ticker, mét beurssuffix. Veelgebruikte suffixen:
  `.AS` Amsterdam · `.BR` Brussel · `.PA` Parijs · `.DE` Xetra · `.L` Londen ·
  `.CO` Kopenhagen · `.KS` Korea · `.T` Tokio · `.TW` Taiwan · (geen suffix) VS.
  **Controleer de ticker** door 'm op [finance.yahoo.com](https://finance.yahoo.com) op te zoeken —
  naam-matching is foutgevoelig (spin-offs, dubbele noteringen).
- **`region`** — `NL` | `EU` | `US` | `ASIA` (bepaalt het regiofilter en of voor-/nabeurs wordt afgeleid).
- **Land & vlag** worden **automatisch** afgeleid uit de beurs (anders de tickersuffix), dus die
  hoef je niet in te vullen. De mapping staat in [`scripts/exchanges.py`](scripts/exchanges.py)
  (`EXCHANGE_COUNTRY` / `SUFFIX_COUNTRY`) en wordt gespiegeld in [`docs/app.js`](docs/app.js);
  voeg je een nieuw land toe, dan zet je daar de landcode + vlag-SVG bij.
- **Bronvermelding:** elk automatisch bedrijf krijgt op het dashboard een **“bron ↗”**-link naar
  zijn Yahoo Finance-pagina, zodat de redactie de datum kan verifiëren.
- **Geen automatische bron?** (niet los genoteerd, bv. ASN Bank) zet dan:
  ```json
  { "name": "ASN Bank", "ticker": null, "exchange": "n.v.t.", "region": "NL", "manual": true,
    "note": "Onderdeel van de Volksbank; niet los beursgenoteerd." }
  ```
  Zulke bedrijven blijven zichtbaar onder **"Handmatig / n.v.t."** in plaats van stilletjes te verdwijnen.

Bij de volgende (dagelijkse of handmatige) run verschijnt de wijziging vanzelf in het dashboard.

---

## Hoe de auto-update werkt

[`.github/workflows/update-agenda.yml`](.github/workflows/update-agenda.yml):

- Draait op **cron `0 4` en `0 5` (UTC), maandag t/m vrijdag**. Samen dekken die 06:00
  Amsterdamse tijd in zowel zomer- (CEST, UTC+2) als wintertijd (CET, UTC+1). De runs zijn
  idempotent: als er niets wijzigt, wordt er niets gecommit.
- Kan ook **handmatig** worden gestart via de **Actions**-tab → *Cijferagenda bijwerken* → *Run workflow*.
- Stappen: code uitchecken → Python installeren → `pip install -r requirements.txt` →
  `python scripts/fetch_agenda.py` → gewijzigde `docs/data/*.json` committen en pushen.
- **Changelog:** elke datumverschuiving wordt gelogd in
  [`docs/data/changelog.json`](docs/data/changelog.json) én is zichtbaar in de git-commithistorie.
  Op het dashboard krijgt een verschoven datum het label **"gewijzigd"** met de oude datum in de tooltip.

> **Let op:** GitHub schakelt geplande workflows uit na 60 dagen zonder repo-activiteit. De
> dagelijkse commits houden de workflow vanzelf actief.

---

## Lokaal draaien

```bash
pip install -r requirements.txt
python scripts/fetch_agenda.py          # ververst docs/data/agenda.json
python -m http.server 8765 --directory docs   # open http://localhost:8765
```

---

## Deployen naar GitHub Pages (eenmalig)

De code staat lokaal klaar. Onderstaande stappen heb je één keer nodig om de live URL te krijgen
(`gh` CLI staat niet op deze machine, dus dit gaat via git + de GitHub-website):

1. **Maak een lege repository** op <https://github.com/new>, bijv. `boekagenda-dashboard`.
   Laat "Add a README" uit.
2. **Push de code** vanuit de projectmap:
   ```bash
   cd "C:/Claude code/boekagenda-dashboard"
   git init
   git add .
   git commit -m "Cijferagenda-dashboard"
   git branch -M main
   git remote add origin https://github.com/<jouw-gebruikersnaam>/boekagenda-dashboard.git
   git push -u origin main
   ```
3. **Zet GitHub Pages aan:** repo → **Settings** → **Pages** → *Build and deployment* →
   Source: **Deploy from a branch** → Branch: **main**, map: **/docs** → **Save**.
   Na ~1 minuut staat het dashboard op
   `https://<jouw-gebruikersnaam>.github.io/boekagenda-dashboard/`.
4. **Geef de workflow schrijfrechten:** repo → **Settings** → **Actions** → **General** →
   *Workflow permissions* → **Read and write permissions** → **Save**.
   (Nodig zodat de dagelijkse run de bijgewerkte data mag terugcommitten.)
5. **Test de automatisering:** repo → **Actions** → *Cijferagenda bijwerken* → **Run workflow**.
   Daarna draait 'ie elke werkdag vanzelf.

Klaar — deel de Pages-URL met de redactie.

---

## Bekende beperkingen

- **Voor-/nabeurs** is alleen hard voor Amerikaanse namen; bij niet-US toont het dashboard
  "tijd onbekend" (Yahoo levert daar geen betrouwbaar tijdstip). Later te verbeteren met een
  betaalde databron of een gerichte IR-scrape.
- **Yahoo is een onofficiële bron:** datums kunnen soms verschuiven of tijdelijk ontbreken
  (dan toont het dashboard "datum nog niet bekend"). Vandaar de "verwacht"-markering, de
  dagelijkse ververs en de changelog.
