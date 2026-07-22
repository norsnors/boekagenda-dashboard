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

  if (c.manual) {
    return `<div class="row manual">
      <div><div class="name">${escapeHtml(c.name)}</div><div class="ticker">${escapeHtml(c.exchange)}</div></div>
      <div class="labels-inline">${escapeHtml(c.note || "Geen automatische bron beschikbaar.")}
        <div class="labels" style="margin-top:6px">${labelsCell(c)}</div></div>
    </div>`;
  }
  if (!c.next_date) {
    return `<div class="row nodate">
      <div><div class="name">${escapeHtml(c.name)}</div><div class="ticker">${ticker}</div></div>
      <div class="time unknown">Nog geen datum bekend bij de bron</div>
    </div>`;
  }
  const d = parseDate(c.next_date);
  return `<div class="${cls.join(" ")}">
    <div><div class="name">${escapeHtml(c.name)}</div><div class="ticker">${ticker}</div></div>
    <div class="cell-date"><span class="date"><span class="weekday">${fmtDate.format(d)}</span></span></div>
    <div>${timeCell(c)}</div>
    <div class="region">${REGION_LABEL[c.region] || ""}</div>
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
      ${showHead ? `<div class="col-head"><div>Bedrijf</div><div>Datum</div><div>Tijd (Ams.)</div><div>Regio</div><div style="text-align:right">Sessie / status</div></div>` : ""}
      <div class="rows">${items.map(rowHtml).join("")}</div>
    </section>`);
  }

  content.innerHTML = parts.join("");
  document.getElementById("empty").hidden = filtered.length > 0;
  document.getElementById("count").textContent =
    `${state.companies.length} bedrijven in de lijst.`;
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
