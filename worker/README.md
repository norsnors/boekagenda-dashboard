# "Bedrijf toevoegen"-Worker — setup

Deze Cloudflare Worker laat de redactie via het dashboardformulier automatisch een bedrijf
toevoegen. De Worker houdt een GitHub-schrijftoken veilig vast (dat mag nooit in de publieke
dashboard-JS) en commit de nieuwe regel naar `scripts/companies.json`.

**Alles kan via de browser — geen installaties.** Eenmalig ~5 minuten.

---

## Stap 1 — GitHub-token maken (fine-grained, alleen deze repo)

1. Ga naar <https://github.com/settings/personal-access-tokens/new> (Settings → Developer
   settings → Personal access tokens → **Fine-grained tokens** → *Generate new token*).
2. **Token name:** `boekagenda-add-worker`. **Expiration:** naar keuze (bv. 1 jaar).
3. **Resource owner:** `norsnors`. **Repository access:** *Only select repositories* →
   **`boekagenda-dashboard`**.
4. **Permissions → Repository permissions:**
   - **Contents:** *Read and write* (verplicht — om te committen).
   - **Actions:** *Read and write* (optioneel — laat de datum meteen ophalen na toevoegen).
5. **Generate token** en **kopieer** de waarde (`github_pat_…`). Je ziet 'm maar één keer.

## Stap 2 — Worker aanmaken op Cloudflare

1. Log in op <https://dash.cloudflare.com> (gratis account volstaat; aanmaken kan met e-mail).
2. **Workers & Pages** → **Create** → **Create Worker**.
3. Geef 'm een naam, bv. `boekagenda-add`. **Deploy** (de standaard "Hello world" is prima).
4. Klik **Edit code**. Verwijder de voorbeeldcode en plak de volledige inhoud van
   [`add-company.js`](add-company.js). **Deploy**.

## Stap 3 — Secrets instellen

In de Worker → **Settings** → **Variables and Secrets** → **Add** (type: *Secret*, "Encrypt"):

| Naam | Waarde |
|---|---|
| `GITHUB_TOKEN` | het token uit stap 1 (`github_pat_…`) |
| `ADD_PASSWORD` | een zelfgekozen "toevoegcode" die je aan de redactie geeft |

**Save and deploy.**

## Stap 4 — Worker-URL in het dashboard zetten

De Worker heeft nu een URL zoals `https://boekagenda-add.<jouw-subdomein>.workers.dev`.
Geef die URL door — dan zet ik 'm in `docs/app.js` (`ADD_WORKER_URL`) en deploy ik. Vanaf dan
schakelt het formulier automatisch over van "GitHub-regel kopiëren" naar één **Toevoegen**-knop.

> Test snel of de Worker leeft: open de URL in de browser. Je hoort `Gebruik POST.` te zien
> (een GET wordt geweigerd) — dat betekent dat de Worker draait.

## Stap 5 — Ochtendwekker (Cron Trigger)

GitHub start de geplande ververs-ronde in de praktijk uren te laat. Gemeten: eind augustus
2026 nog 40 minuten, half oktober 7 à 8 uur, en oplopend. De Worker start de ronde daarom zelf.

1. Plak de nieuwste [`add-company.js`](add-company.js) in de Worker (**Edit code** → **Deploy**).
   Die bevat een `scheduled`-functie: die kijkt of `agenda.json` vandaag na 04:00 UTC al is
   ververst, en start de fetch-workflow alleen als dat niet zo is.
2. Worker → **Settings** → **Trigger Events** → **Add** → **Cron Triggers**, drie keer:
   `0 4 * * 1-5`, `0 5 * * 1-5` en `0 6 * * 1-5`. Cloudflare rekent in UTC. De eerste doet het
   werk (06:00 zomertijd, 05:00 wintertijd); de andere twee zijn het vangnet als een ronde
   mislukt en kosten niets als de agenda al vers is.
3. Het `GITHUB_TOKEN` heeft **Contents: Read and write** en **Actions: Read and write** nodig
   (stap 1). Ontbreekt Actions, maak dan een nieuw token en vervang het secret.

Controle: de volgende ochtend staat er in de Actions-tab een run met event `workflow_dispatch`
rond 04:00 UTC, en het dashboard toont "Laatst bijgewerkt" van die ochtend. In de Worker zie je
onder **Logs** per trigger "Ververs-ronde gestart" of "Agenda al ververst".

## Wat er gebeurt als het toch misgaat

- **Yahoo stuk** (meer dan de helft van de bedrijven geeft niets): de fetcher overschrijft de
  agenda niet en de ronde faalt. GitHub mailt dan het account norsnors; de volgende trigger
  probeert het opnieuw.
- **Agenda niet vers:** staat de agenda na 07:30 op een werkdag nog niet op die ochtend, dan
  toont het dashboard bovenaan een rode melding met het tijdstip van de laatste verversing.
- De geplande runs van GitHub zelf blijven als laatste vangnet staan; ze komen 's middags
  binnen en verversen dan nog een keer.

---

## Hoe het werkt

```
dashboardformulier  ──POST {name,ticker,exchange,region,password}──▶  Worker
                                                                       │  (token server-side)
                                     commit scripts/companies.json  ◀──┤
                                     trigger fetch-workflow (optie)  ◀──┘
                                                                       │
        agenda.json bijgewerkt + Pages redeploy  ──▶  bedrijf zichtbaar (met datum), ~2 min
```

- **Beveiliging:** de `ADD_PASSWORD` weert willekeurige inzendingen; het token blijft server-side.
  CORS staat alleen de Pages-origin (en localhost) toe. Voor een interne redactietool is dat
  voldoende; wil je meer, dan kun je later Cloudflare Access ervoor zetten.
- **Duplicaten** worden geweigerd (op ticker/naam).
- **Zonder ticker** (niet los beursgenoteerd) wordt het bedrijf als `manual` toegevoegd, net als
  ASN Bank.

## Alternatief: deployen met Wrangler (CLI)

Als je toch de CLI wilt gebruiken:

```bash
npm i -g wrangler
wrangler login
wrangler deploy worker/add-company.js --name boekagenda-add
wrangler secret put GITHUB_TOKEN   # plak het token
wrangler secret put ADD_PASSWORD   # kies de code
```
