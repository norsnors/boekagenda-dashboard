"use strict";

const DATA_URL = "./data/agenda.json";
const state = { companies: [], region: "all", query: "" };

const fmtDate = new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", month: "short" });
const fmtUpdated = new Intl.DateTimeFormat("nl-NL", {
  day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
});

/* Parse "YYYY-MM-DD" naar een lokale datum (middernacht), tz-veilig. */
function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfToday() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/* Einde van de huidige week (zondag, middernacht erna). */
function endOfWeek(today) {
  const dow = (today.getDay() + 6) % 7; // maandag=0 … zondag=6
  const end = new Date(today);
  end.setDate(today.getDate() + (6 - dow) + 1); // maandag na deze week
  return end;
}

const SESSION = {
  voorbeurs: { label: "Voorbeurs", cls: "pill-voorbeurs" },
  nabeurs: { label: "Nabeurs", cls: "pill-nabeurs" },
  "tijdens handel": { label: "Tijdens handel", cls: "pill-handel" },
  onbekend: { label: "Tijd onbekend", cls: "pill-unknown" },
};

const REGION_LABEL = { NL: "Nederland", EU: "Europa", US: "VS", ASIA: "Azië" };

/* GitHub-repo waarin companies.json staat (voor de 'bedrijf toevoegen'-flow). */
const REPO = "norsnors/boekagenda-dashboard";
const COMPANIES_EDIT_URL = `https://github.com/${REPO}/edit/main/scripts/companies.json`;

/* Cloudflare Worker die een bedrijf automatisch toevoegt (zie worker/README.md).
   Zolang deze leeg is, valt het formulier terug op de handmatige GitHub-methode.
   Vul hier de Worker-URL in (bv. "https://boekagenda-add.<subdomein>.workers.dev"). */
const ADD_WORKER_URL = "https://boekagenda-add.daanmol-1.workers.dev";

/* ---------- Landen & vlaggen ----------
   Vlaggen zijn kleine inline-SVG's (betrouwbaar op Windows, waar flag-emoji als
   "NL"/"US" tonen). De beurs->land en tickersuffix->land maps spiegelen die in
   scripts/exchanges.py — houd ze in sync bij het toevoegen van een land. */
const FLAG = {
  NL: `<svg class="flag" viewBox="0 0 3 2"><rect width="3" height="2" fill="#21468b"/><rect width="3" height="1.333" fill="#fff"/><rect width="3" height=".667" fill="#ae1c28"/></svg>`,
  FR: `<svg class="flag" viewBox="0 0 3 2"><rect width="3" height="2" fill="#fff"/><rect width="1" height="2" fill="#002654"/><rect x="2" width="1" height="2" fill="#ce1126"/></svg>`,
  BE: `<svg class="flag" viewBox="0 0 3 2"><rect width="1" height="2" fill="#000"/><rect x="1" width="1" height="2" fill="#fae042"/><rect x="2" width="1" height="2" fill="#ed2939"/></svg>`,
  DE: `<svg class="flag" viewBox="0 0 3 2"><rect width="3" height="2" fill="#ffce00"/><rect width="3" height="1.333" fill="#dd0000"/><rect width="3" height=".667" fill="#000"/></svg>`,
  IT: `<svg class="flag" viewBox="0 0 3 2"><rect width="3" height="2" fill="#fff"/><rect width="1" height="2" fill="#009246"/><rect x="2" width="1" height="2" fill="#ce2b37"/></svg>`,
  ES: `<svg class="flag" viewBox="0 0 3 2"><rect width="3" height="2" fill="#c60b1e"/><rect y=".5" width="3" height="1" fill="#ffc400"/></svg>`,
  CH: `<svg class="flag flag-sq" viewBox="0 0 32 32"><rect width="32" height="32" fill="#d52b1e"/><rect x="13" y="6" width="6" height="20" fill="#fff"/><rect x="6" y="13" width="20" height="6" fill="#fff"/></svg>`,
  SE: `<svg class="flag" viewBox="0 0 16 10"><rect width="16" height="10" fill="#006aa7"/><rect x="5" width="2" height="10" fill="#fecc00"/><rect y="4" width="16" height="2" fill="#fecc00"/></svg>`,
  DK: `<svg class="flag" viewBox="0 0 37 28"><rect width="37" height="28" fill="#c8102e"/><rect x="12" width="4" height="28" fill="#fff"/><rect y="12" width="37" height="4" fill="#fff"/></svg>`,
  NO: `<svg class="flag" viewBox="0 0 22 16"><rect width="22" height="16" fill="#ba0c2f"/><rect x="6" width="4" height="16" fill="#fff"/><rect y="6" width="22" height="4" fill="#fff"/><rect x="7" width="2" height="16" fill="#00205b"/><rect y="7" width="22" height="2" fill="#00205b"/></svg>`,
  FI: `<svg class="flag" viewBox="0 0 18 11"><rect width="18" height="11" fill="#fff"/><rect x="5" width="3" height="11" fill="#003580"/><rect y="4" width="18" height="3" fill="#003580"/></svg>`,
  GB: `<svg class="flag" viewBox="0 0 60 30"><rect width="60" height="30" fill="#012169"/><path d="M0,0 60,30 M60,0 0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 60,30 M60,0 0,30" stroke="#c8102e" stroke-width="4"/><rect x="25" width="10" height="30" fill="#fff"/><rect y="10" width="60" height="10" fill="#fff"/><rect x="27" width="6" height="30" fill="#c8102e"/><rect y="12" width="60" height="6" fill="#c8102e"/></svg>`,
  US: `<svg class="flag" viewBox="0 0 39 26"><rect width="39" height="26" fill="#b22234"/><g fill="#fff"><rect y="2" width="39" height="2"/><rect y="6" width="39" height="2"/><rect y="10" width="39" height="2"/><rect y="14" width="39" height="2"/><rect y="18" width="39" height="2"/><rect y="22" width="39" height="2"/></g><rect width="15.6" height="14" fill="#3c3b6e"/><g fill="#fff"><circle cx="3" cy="3" r="1"/><circle cx="8" cy="3" r="1"/><circle cx="13" cy="3" r="1"/><circle cx="5.5" cy="7" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="3" cy="11" r="1"/><circle cx="8" cy="11" r="1"/><circle cx="13" cy="11" r="1"/></g></svg>`,
  JP: `<svg class="flag" viewBox="0 0 3 2"><rect width="3" height="2" fill="#fff"/><circle cx="1.5" cy="1" r=".6" fill="#bc002d"/></svg>`,
  KR: `<svg class="flag" viewBox="0 0 60 40"><rect width="60" height="40" fill="#fff"/><circle cx="30" cy="20" r="12" fill="#0047a0"/><path d="M18,20 A12,12 0 0,1 42,20 Z" fill="#cd2e3a"/><circle cx="24" cy="20" r="6" fill="#cd2e3a"/><circle cx="36" cy="20" r="6" fill="#0047a0"/></svg>`,
  TW: `<svg class="flag" viewBox="0 0 60 40"><rect width="60" height="40" fill="#fe0000"/><rect width="30" height="20" fill="#000095"/><circle cx="15" cy="10" r="6" fill="#fff"/><circle cx="15" cy="10" r="4.5" fill="#000095"/><circle cx="15" cy="10" r="2.5" fill="#fff"/></svg>`,
};
const FLAG_UNKNOWN = `<svg class="flag flag-unknown" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1,10 h18 M10,1 v18 M10,1 a13,13 0 0 1 0,18 a13,13 0 0 1 0,-18" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>`;

const COUNTRY_NAME = {
  NL: "Nederland", US: "Verenigde Staten", FR: "Frankrijk", GB: "Verenigd Koninkrijk",
  DE: "Duitsland", BE: "België", KR: "Zuid-Korea", DK: "Denemarken", JP: "Japan",
  TW: "Taiwan", IT: "Italië", ES: "Spanje", CH: "Zwitserland", SE: "Zweden",
  NO: "Noorwegen", FI: "Finland", AT: "Oostenrijk", PT: "Portugal", IE: "Ierland",
  HK: "Hongkong",
};

const EXCHANGE_COUNTRY = {
  "Euronext Amsterdam": "NL", "Euronext Paris": "FR", "Euronext Brussel": "BE",
  "London Stock Exchange": "GB", "Frankfurt (Xetra)": "DE", "Nasdaq": "US",
  "NYSE": "US", "Korea Exchange (KRX)": "KR", "Nasdaq Copenhagen": "DK",
  "Tokyo (TSE)": "JP", "Taiwan (TWSE)": "TW",
};
const SUFFIX_COUNTRY = {
  AS: "NL", PA: "FR", BR: "BE", L: "GB", DE: "DE", KS: "KR", CO: "DK", T: "JP",
  TW: "TW", MI: "IT", MC: "ES", SW: "CH", ST: "SE", HE: "FI", OL: "NO", VI: "AT",
  LS: "PT", IR: "IE", HK: "HK",
};
const REGION_COUNTRY = { NL: "NL", US: "US" };

/* Landcode voor een bedrijf: veld uit de data, anders afgeleid uit beurs/ticker/regio. */
function countryOf(c) {
  if (c.country) return c.country;
  const exch = (c.exchange || "").trim();
  if (EXCHANGE_COUNTRY[exch]) return EXCHANGE_COUNTRY[exch];
  const ticker = c.yahoo_ticker || c.ticker || "";
  if (ticker.includes(".")) {
    const suffix = ticker.split(".").pop().toUpperCase();
    if (SUFFIX_COUNTRY[suffix]) return SUFFIX_COUNTRY[suffix];
  } else if (ticker) {
    return "US";
  }
  return REGION_COUNTRY[c.region] || null;
}

function countryCell(c) {
  const code = countryOf(c);
  const flag = (code && FLAG[code]) || FLAG_UNKNOWN;
  const name = (code && COUNTRY_NAME[code]) || REGION_LABEL[c.region] || "—";
  return `<span class="country">${flag}<span class="country-name">${escapeHtml(name)}</span></span>`;
}

/* Bron-URL voor verificatie: veld uit de data, anders de Yahoo-pagina van de ticker. */
function sourceOf(c) {
  if (c.source_url) return c.source_url;
  const ticker = c.yahoo_ticker || c.ticker;
  return ticker ? `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}` : null;
}

function sourceLink(c) {
  const url = sourceOf(c);
  if (!url) return "";
  return ` · <a class="src" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Verifieer de datum op Yahoo Finance">bron ↗</a>`;
}

function groupFor(c, today, weekEnd) {
  if (c.manual) return "manual";
  if (!c.next_date) return "nodate";
  const d = parseDate(c.next_date);
  const days = Math.round((d - today) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (d < weekEnd) return "week";
  if (days <= 14) return "twoweeks";
  return "later";
}

const GROUPS = [
  { key: "today", title: "Vandaag", hot: true },
  { key: "tomorrow", title: "Morgen", hot: true },
  { key: "week", title: "Deze week", hot: false },
  { key: "twoweeks", title: "Komende twee weken", hot: false },
  { key: "later", title: "Later", hot: false },
  { key: "nodate", title: "Datum nog niet bekend", hot: false },
  { key: "manual", title: "Handmatig / n.v.t.", hot: false },
];

function timeCell(c) {
  if (c.manual) return "";
  if (c.time_known && c.next_datetime_ams) {
    const t = new Date(c.next_datetime_ams);
    const hh = String(t.getHours()).padStart(2, "0");
    const mm = String(t.getMinutes()).padStart(2, "0");
    return `<span class="time">${hh}:${mm}</span>`;
  }
  return `<span class="time unknown">tijd onbekend</span>`;
}

function labelsCell(c) {
  const out = [];
  if (c.manual) {
    out.push(`<span class="badge badge-manual">handmatig / n.v.t.</span>`);
    return out.join("");
  }
  const s = SESSION[c.session] || SESSION.onbekend;
  out.push(`<span class="pill ${s.cls}">${s.label}</span>`);
  if (c.status === "verwacht") out.push(`<span class="badge badge-expected">verwacht</span>`);
  else if (c.status === "bevestigd") out.push(`<span class="badge badge-confirmed">bevestigd</span>`);
  if (c.changed_since_yesterday && c.previous_date) {
    const prev = fmtDate.format(parseDate(c.previous_date));
    out.push(`<span class="badge badge-changed" title="Was: ${prev}">gewijzigd</span>`);
  }
  return out.join("");
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

function rowHtml(c) {
  const cls = ["row"];
  if (c.status === "verwacht") cls.push("expected");
  const ticker = c.yahoo_ticker ? `${escapeHtml(c.yahoo_ticker)} · ${escapeHtml(c.exchange)}` : escapeHtml(c.exchange);
  const identity = `${ticker}${sourceLink(c)}`;

  if (c.manual) {
    return `<div class="row manual">
      <div><div class="name">${escapeHtml(c.name)}</div><div class="ticker">${escapeHtml(c.exchange)}${sourceLink(c)}</div></div>
      <div class="labels-inline">${escapeHtml(c.note || "Geen automatische bron beschikbaar.")}
        <div class="labels" style="margin-top:6px">${labelsCell(c)}</div></div>
    </div>`;
  }
  if (!c.next_date) {
    return `<div class="row nodate">
      <div><div class="name">${escapeHtml(c.name)}</div><div class="ticker">${identity}</div></div>
      <div class="time unknown">Nog geen datum bekend bij de bron</div>
    </div>`;
  }
  const d = parseDate(c.next_date);
  return `<div class="${cls.join(" ")}">
    <div><div class="name">${escapeHtml(c.name)}</div><div class="ticker">${identity}</div></div>
    <div class="cell-date"><span class="date"><span class="weekday">${fmtDate.format(d)}</span></span></div>
    <div>${timeCell(c)}</div>
    <div class="region">${countryCell(c)}</div>
    <div class="labels">${labelsCell(c)}</div>
  </div>`;
}

function render() {
  const today = startOfToday();
  const weekEnd = endOfWeek(today);
  const q = state.query.trim().toLowerCase();

  const filtered = state.companies.filter((c) => {
    if (state.region !== "all" && c.region !== state.region) return false;
    if (q && !c.name.toLowerCase().includes(q)) return false;
    return true;
  });

  const buckets = {};
  for (const c of filtered) {
    const g = groupFor(c, today, weekEnd);
    (buckets[g] ||= []).push(c);
  }

  const content = document.getElementById("content");
  const parts = [];
  for (const g of GROUPS) {
    const items = buckets[g.key];
    if (!items || !items.length) continue;
    const showHead = !["nodate", "manual"].includes(g.key);
    parts.push(`<section class="section ${g.hot ? "hot" : ""}">
      <h2>${g.title} <span class="cnt">${items.length}</span></h2>
      ${showHead ? `<div class="col-head"><div>Bedrijf</div><div>Datum</div><div>Tijd (Ams.)</div><div>Land</div><div style="text-align:right">Sessie / status</div></div>` : ""}
      <div class="rows">${items.map(rowHtml).join("")}</div>
    </section>`);
  }

  content.innerHTML = parts.join("");
  document.getElementById("empty").hidden = filtered.length > 0;
  document.getElementById("count").textContent =
    `${state.companies.length} bedrijven in de lijst.`;
}

/* ---------- Bedrijf toevoegen ---------- */
const COUNTRY_REGION = {
  NL: "NL", US: "US",
  GB: "EU", FR: "EU", DE: "EU", BE: "EU", DK: "EU", IT: "EU", ES: "EU",
  CH: "EU", SE: "EU", NO: "EU", FI: "EU", AT: "EU", PT: "EU", IE: "EU",
  KR: "ASIA", JP: "ASIA", TW: "ASIA", HK: "ASIA",
};

/* Eén companies.json-regel in de huisstijl van het bestand. */
function jsonLine(obj) {
  const inner = Object.entries(obj)
    .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(", ");
  return `    { ${inner} },`;
}

function setupAddPanel() {
  const panel = document.getElementById("add-panel");
  const toggle = document.getElementById("add-toggle");
  if (!panel || !toggle) return;

  const auto = !!ADD_WORKER_URL; // Worker ingesteld => automatisch toevoegen, anders GitHub-terugval
  const $ = (id) => document.getElementById(id);
  const els = {
    name: $("f-name"), ticker: $("f-ticker"), exchange: $("f-exchange"), region: $("f-region"),
    password: $("f-password"), pwField: $("pw-field"),
    body: $("add-body"), intro: $("add-intro"), country: $("preview-country"),
    autoBlock: $("auto-block"), submit: $("f-submit"), status: $("add-status"),
    manualBlock: $("manual-block"), snippet: $("f-snippet"), copy: $("f-copy"), github: $("f-github"),
  };

  // Beurs-suggesties uit de bekende beurzen.
  const dl = $("exchange-list");
  if (dl) dl.innerHTML = Object.keys(EXCHANGE_COUNTRY)
    .map((x) => `<option value="${escapeHtml(x)}"></option>`).join("");

  // Modus instellen.
  els.intro.textContent = auto
    ? "Vul de gegevens in en klik op Toevoegen. Het bedrijf wordt automatisch aan het dashboard toegevoegd en verschijnt binnen enkele minuten — de publicatiedatum komt er bij de eerstvolgende update bij."
    : "Vul de gegevens in. Je krijgt een kant-en-klare regel plus een link om companies.json op GitHub te openen. Na de eerstvolgende dagelijkse update verschijnt de publicatiedatum vanzelf.";
  els.pwField.hidden = !auto;
  els.autoBlock.hidden = !auto;
  els.manualBlock.hidden = auto;
  els.body.hidden = false;
  if (!auto) els.github.href = COMPANIES_EDIT_URL;

  let regionTouched = false; // zodra de redacteur zelf een regio kiest, niet meer overschrijven

  toggle.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) els.name.focus();
  });

  function update() {
    const name = els.name.value.trim();
    const ticker = els.ticker.value.trim();
    const exchange = els.exchange.value.trim();

    const code = countryOf({ exchange, yahoo_ticker: ticker, region: els.region.value });
    // Regio automatisch meelaten bewegen met het herkende land, tenzij handmatig gezet.
    if (!regionTouched && code && COUNTRY_REGION[code]) els.region.value = COUNTRY_REGION[code];
    const region = els.region.value;

    if (!name) {
      els.country.innerHTML = `<span class="preview-empty">— vul een bedrijfsnaam in</span>`;
      if (!auto) els.snippet.value = "";
      return;
    }

    const flag = (code && FLAG[code]) || FLAG_UNKNOWN;
    const cname = (code && COUNTRY_NAME[code]) || "onbekend — controleer beurs/ticker";
    els.country.innerHTML = `${flag}<span>${escapeHtml(cname)}</span>`;

    if (!auto) {
      const obj = ticker
        ? { name, ticker, exchange, region }
        : { name, ticker: null, exchange: exchange || "n.v.t.", region,
            manual: true, note: "Handmatig toegevoegd — geen automatische bron." };
      els.snippet.value = jsonLine(obj);
    }
  }

  [els.name, els.ticker, els.exchange].forEach((el) => el.addEventListener("input", update));
  els.exchange.addEventListener("change", update);
  els.region.addEventListener("change", () => { regionTouched = true; update(); });
  update();

  if (auto) {
    const setStatus = (msg, kind) => {
      els.status.textContent = msg;
      els.status.className = "add-status" + (kind ? " " + kind : "");
    };
    els.submit.addEventListener("click", async () => {
      const payload = {
        name: els.name.value.trim(),
        ticker: els.ticker.value.trim(),
        exchange: els.exchange.value.trim(),
        region: els.region.value,
        password: els.password.value,
      };
      if (!payload.name) return setStatus("Vul een bedrijfsnaam in.", "err");
      if (!payload.password) return setStatus("Vul de toevoegcode in.", "err");

      els.submit.disabled = true;
      setStatus("Bezig met toevoegen…", "");
      try {
        const res = await fetch(ADD_WORKER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || `Fout (${res.status})`);
        setStatus(`✓ "${data.name}" toegevoegd — verschijnt binnen enkele minuten.`, "ok");
        els.name.value = ""; els.ticker.value = ""; els.exchange.value = "";
        regionTouched = false;
        update();
      } catch (err) {
        setStatus(`Niet gelukt: ${err.message}`, "err");
      } finally {
        els.submit.disabled = false;
      }
    });
  } else {
    els.copy.addEventListener("click", async () => {
      els.snippet.select();
      try {
        await navigator.clipboard.writeText(els.snippet.value);
      } catch {
        document.execCommand("copy");
      }
      const orig = els.copy.textContent;
      els.copy.textContent = "Gekopieerd ✓";
      setTimeout(() => { els.copy.textContent = orig; }, 1500);
    });
  }
}

async function init() {
  const search = document.getElementById("search");
  search.addEventListener("input", (e) => { state.query = e.target.value; render(); });
  document.getElementById("regions").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    state.region = btn.dataset.region;
    render();
  });

  setupAddPanel();

  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.companies = data.companies || [];
    const gen = data.generated_at ? new Date(data.generated_at) : null;
    document.getElementById("updated-value").textContent =
      gen ? fmtUpdated.format(gen) : "onbekend";
    render();
  } catch (err) {
    document.getElementById("content").innerHTML =
      `<p class="empty">Kon de agenda niet laden (${escapeHtml(String(err.message))}).</p>`;
  }
}

init();
