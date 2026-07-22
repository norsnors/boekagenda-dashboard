/**
 * Cloudflare Worker — "Bedrijf toevoegen" voor het cijferagenda-dashboard.
 *
 * Waarom een Worker? Het dashboard is een statische GitHub Pages-site zonder
 * server. Om automatisch een bedrijf aan scripts/companies.json toe te voegen
 * is een GitHub-schrijftoken nodig, en dat mag NIET in de publieke dashboard-JS
 * staan. Deze Worker houdt het token veilig server-side vast: het dashboard-
 * formulier POST't hierheen, de Worker commit de nieuwe regel naar de repo en
 * start (optioneel) de fetch-workflow zodat de datum er meteen bij komt.
 *
 * Vereiste Worker-secrets (via `wrangler secret put` of het Cloudflare-dashboard):
 *   GITHUB_TOKEN  — fine-grained PAT met Contents: Read and write (en Actions:
 *                   Read and write als je de workflow direct wil triggeren),
 *                   beperkt tot de repo norsnors/boekagenda-dashboard.
 *   ADD_PASSWORD  — gedeelde "toevoegcode" die de redactie in het formulier
 *                   invult. Weert willekeurige inzendingen op de publieke URL.
 *
 * Zie worker/README.md voor de volledige setup.
 */

const OWNER = "norsnors";
const REPO = "boekagenda-dashboard";
const PATH = "scripts/companies.json";
const BRANCH = "main";
const WORKFLOW_FILE = "update-agenda.yml"; // fetch-workflow; leeg maken om niet te triggeren
const GH = "https://api.github.com";

// Origins die het formulier mogen aanroepen (CORS). localhost voor lokaal testen.
const ALLOWED_ORIGINS = new Set([
  "https://norsnors.github.io",
  "http://localhost:8765",
]);

const REGIONS = new Set(["NL", "EU", "US", "ASIA"]);

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Gebruik POST." }, 405, cors);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Ongeldige JSON." }, 400, cors);
    }

    // 1) Toegangscontrole.
    if (!env.ADD_PASSWORD || body.password !== env.ADD_PASSWORD) {
      return json({ error: "Onjuiste toevoegcode." }, 401, cors);
    }

    // 2) Validatie.
    const name = str(body.name);
    const ticker = str(body.ticker);
    const exchange = str(body.exchange);
    const region = str(body.region).toUpperCase();
    if (!name) return json({ error: "Bedrijfsnaam is verplicht." }, 400, cors);
    if (!REGIONS.has(region)) return json({ error: "Regio moet NL, EU, US of ASIA zijn." }, 400, cors);
    if (name.length > 80 || ticker.length > 20 || exchange.length > 60) {
      return json({ error: "Een veld is te lang." }, 400, cors);
    }

    try {
      // 3) Huidige companies.json ophalen.
      const file = await ghJson(`${GH}/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`, env);
      const data = JSON.parse(b64ToStr(file.content));
      const companies = data.companies || [];

      // 4) Duplicaatcheck (op ticker, anders op naam — hoofdletterongevoelig).
      const dupKey = (ticker || name).toLowerCase();
      const exists = companies.some((c) =>
        ((c.ticker || "") ? String(c.ticker).toLowerCase() === dupKey : String(c.name).toLowerCase() === dupKey) ||
        String(c.name).toLowerCase() === name.toLowerCase());
      if (exists) return json({ error: `"${name}" staat al in de lijst.` }, 409, cors);

      // 5) Nieuw object in dezelfde vorm als de rest van de lijst.
      const entry = ticker
        ? { name, ticker, exchange, region }
        : { name, ticker: null, exchange: exchange || "n.v.t.", region,
            manual: true, note: "Handmatig toegevoegd — geen automatische bron." };
      companies.push(entry);
      data.companies = companies;

      // 6) Committen (huisstijl behouden: één bedrijf per regel).
      const newText = serialize(data);
      await ghSend(`${GH}/repos/${OWNER}/${REPO}/contents/${PATH}`, env, "PUT", {
        message: `Bedrijf toegevoegd via dashboard: ${name}`,
        content: strToB64(newText),
        sha: file.sha,
        branch: BRANCH,
      });

      // 7) Best-effort: fetch-workflow starten zodat de datum er snel bij komt.
      let fetched = false;
      if (WORKFLOW_FILE) {
        try {
          const r = await ghSend(
            `${GH}/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
            env, "POST", { ref: BRANCH });
          fetched = r.ok;
        } catch { /* niet fataal */ }
      }

      return json({ ok: true, name, fetched }, 200, cors);
    } catch (err) {
      return json({ error: `Kon niet toevoegen: ${err.message}` }, 502, cors);
    }
  },
};

/* ---------- helpers ---------- */

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://norsnors.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
  });
}

function str(v) {
  return (v == null ? "" : String(v)).trim();
}

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "boekagenda-add-worker",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghJson(url, env) {
  const r = await fetch(url, { headers: ghHeaders(env) });
  if (!r.ok) throw new Error(`GitHub GET ${r.status}`);
  return r.json();
}

async function ghSend(url, env, method, payload) {
  const r = await fetch(url, {
    method,
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok && r.status !== 204) {
    const t = await r.text().catch(() => "");
    throw new Error(`GitHub ${method} ${r.status} ${t.slice(0, 140)}`);
  }
  return r;
}

/* base64 <-> UTF-8 string (Workers hebben atob/btoa maar geen UTF-8-afhandeling). */
function b64ToStr(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function strToB64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

/* Serialiseer companies.json in de huisstijl: één bedrijf per regel, { "k": v }. */
function serialize(data) {
  const line = (obj) => {
    const inner = Object.entries(obj)
      .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
      .join(", ");
    return `    { ${inner} }`;
  };
  const comment = data._comment !== undefined
    ? `  "_comment": ${JSON.stringify(data._comment)},\n` : "";
  const rows = data.companies.map(line).join(",\n");
  return `{\n${comment}  "companies": [\n${rows}\n  ]\n}\n`;
}
