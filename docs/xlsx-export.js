"use strict";
/* ------------------------------------------------------------------
   xlsx-export.js — exporteert de cijferagenda naar een .xlsx-bestand
   dat 1-op-1 aansluit op het teamsheet "Boekagenda cijfers" (SharePoint).

   Volledig zelfstandig: bouwt de OOXML + een STORE-only ZIP in pure
   vanilla JS, geen externe library nodig. Vult kolom A (datum) en
   kolom B (bedrijf + sessie-suffix, gekleurd op beurs-regio) voor;
   de overige redactiekolommen blijven leeg om zelf in te vullen.
   ------------------------------------------------------------------ */
(function () {
  /* ---------- ZIP (STORE, geen compressie) ---------- */
  function crc32(bytes) {
    if (!crc32.table) {
      const t = (crc32.table = new Uint32Array(256));
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ crc32.table[(crc ^ bytes[i]) & 0xff];
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipStore(files) {
    const enc = new TextEncoder();
    const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
    const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      const name = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const local = new Uint8Array([].concat(
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length),
        u16(name.length), u16(0)
      ));
      chunks.push(local, name, data);
      const cent = new Uint8Array([].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length),
        u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)
      ));
      central.push({ header: cent, name });
      offset += local.length + name.length + data.length;
    }

    const centralStart = offset;
    let centralSize = 0;
    for (const c of central) { chunks.push(c.header, c.name); centralSize += c.header.length + c.name.length; }
    chunks.push(new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0),
      u16(central.length), u16(central.length),
      u32(centralSize), u32(centralStart), u16(0)
    )));

    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }

  /* ---------- Helpers ---------- */
  const xesc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

  function excelSerial(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const utc = Date.UTC(y, m - 1, d);
    const epoch = Date.UTC(1899, 11, 30);
    return Math.round((utc - epoch) / 86400000);
  }

  function colLetter(n) {
    let s = "";
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
    return s;
  }

  /* Beurs-regio -> vulkleur-stijl (zie styles.xml).
     NL = oranje, VS = blauw, overige landen = groen — net als het teamsheet. */
  function fillStyleFor(region) {
    if (region === "NL") return 3;
    if (region === "US") return 4;
    return 5;
  }

  /* Beurs-regio -> CSS-vulkleur (dezelfde tinten als het teamsheet). */
  function colorHex(region) {
    if (region === "NL") return "#FFC000";
    if (region === "US") return "#00B0F0";
    return "#92D050";
  }

  /* Bedrijfsnaam met sessie-suffix zoals de redactie het noteert. */
  function nameWithSession(c) {
    if (c.session === "voorbeurs") return c.name + " (voorbeurs)";
    if (c.session === "nabeurs") return c.name + " (nabeurs)";
    return c.name;
  }

  const pad2 = (n) => String(n).padStart(2, "0");
  function fmtDMY(dateStr) {
    const [y, m, d] = dateStr.split("-");
    return `${pad2(+d)}-${pad2(+m)}-${y}`;
  }

  /* Geordende rijen: gesorteerd op datum, lege scheidingsregel tussen datumgroepen,
     bedrijven zonder datum onderaan. Gedeeld door de klembord-builders. */
  function orderedRows(companies) {
    const dated = companies
      .filter((c) => !c.manual && c.next_date)
      .sort((a, b) => (a.next_date < b.next_date ? -1 : a.next_date > b.next_date ? 1 : a.name.localeCompare(b.name)));
    const undated = companies.filter((c) => !c.manual && !c.next_date);
    const rows = [];
    let prev = null;
    for (const c of dated) {
      if (prev !== null && c.next_date !== prev) rows.push({ blank: true });
      rows.push({ date: fmtDMY(c.next_date), name: nameWithSession(c), color: colorHex(c.region) });
      prev = c.next_date;
    }
    if (undated.length) {
      rows.push({ blank: true });
      rows.push({ label: "Datum nog niet bekend:" });
      for (const c of undated) rows.push({ date: "", name: nameWithSession(c), color: colorHex(c.region) });
    }
    return rows;
  }

  const HEADERS = [
    "Datum publicatie cijfers", "Bedrijf", "naam ceo", "Voor Ochtendspits",
    "Voor ZD", "vg (voor ZD)", "Status", "tijdstip uitzending",
    "tel ceo", "tel wv", "e-mail wv", "contactgeschiedenis",
  ];

  function quarterLabel(now) {
    const q = Math.floor(now.getMonth() / 3) + 1;
    return `Q${q} ${now.getFullYear()}`;
  }

  /* ---------- Statische OOXML-onderdelen ---------- */
  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd-mm-yyyy"/></numFmts>
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFC000"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF00B0F0"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF92D050"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  }

  function workbookXml(sheetName) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xesc(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  }

  const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const WB_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  /* ---------- Werkblad opbouwen ---------- */
  function worksheetXml(companies) {
    // cellen verzamelen per rij: rows[rowNum] = [{c: colIndex, xml}]
    const rows = {};
    const add = (r, c, xml) => { (rows[r] ||= []).push({ c, xml }); };

    const strCell = (r, col, style, text) =>
      add(r, col, `<c r="${colLetter(col)}${r}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xesc(text)}</t></is></c>`);
    const dateCell = (r, col, dateStr) =>
      add(r, col, `<c r="${colLetter(col)}${r}" s="2"><v>${excelSerial(dateStr)}</v></c>`);

    // Header op rij 2 (zoals het teamsheet).
    HEADERS.forEach((h, i) => strCell(2, i + 1, 1, h));

    // Legenda rechts (kolom O), net als het teamsheet.
    strCell(2, 15, 1, "Legenda beurs-regio");
    strCell(3, 15, 3, "beurs in Nederland");
    strCell(4, 15, 4, "beurs in VS");
    strCell(5, 15, 5, "beurs in overige landen");

    // Datable bedrijven, gesorteerd op datum en daarna naam.
    const dated = companies
      .filter((c) => !c.manual && c.next_date)
      .sort((a, b) => (a.next_date < b.next_date ? -1 : a.next_date > b.next_date ? 1 : a.name.localeCompare(b.name)));
    const undated = companies.filter((c) => !c.manual && !c.next_date);

    let row = 4;
    let prevDate = null;
    for (const c of dated) {
      if (prevDate !== null && c.next_date !== prevDate) row++; // lege regel tussen datumgroepen
      dateCell(row, 1, c.next_date);
      strCell(row, 2, fillStyleFor(c.region), nameWithSession(c));
      prevDate = c.next_date;
      row++;
    }

    // Bedrijven zonder bekende datum onderaan (kolom A leeg).
    if (undated.length) {
      row++;
      strCell(row, 1, 0, "Datum nog niet bekend:");
      row++;
      for (const c of undated) {
        strCell(row, 2, fillStyleFor(c.region), nameWithSession(c));
        row++;
      }
    }

    // Rijen serialiseren in oplopende volgorde, cellen per rij op kolom gesorteerd.
    const rowNums = Object.keys(rows).map(Number).sort((a, b) => a - b);
    const body = rowNums.map((r) => {
      const cells = rows[r].sort((a, b) => a.c - b.c).map((x) => x.xml).join("");
      return `<row r="${r}">${cells}</row>`;
    }).join("");

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols>
<col min="1" max="1" width="16" customWidth="1"/>
<col min="2" max="2" width="26" customWidth="1"/>
<col min="3" max="3" width="22" customWidth="1"/>
<col min="4" max="6" width="14" customWidth="1"/>
<col min="7" max="7" width="14" customWidth="1"/>
<col min="8" max="8" width="18" customWidth="1"/>
<col min="12" max="12" width="24" customWidth="1"/>
<col min="15" max="15" width="24" customWidth="1"/>
</cols>
<sheetData>${body}</sheetData>
</worksheet>`;
  }

  /* ---------- Klembord (plak-klaar in Excel/SharePoint) ---------- */
  /* HTML-tabel met celkleuren: Excel (ook Excel Online) neemt achtergrondkleuren
     bij plakken over. Alleen kolom A (datum) + B (bedrijf) worden gevuld; de
     overige redactiekolommen blijven leeg. */
  function buildClipboardHtml(companies) {
    const th = (t) => `<td style="font-weight:bold;border:1px solid #ccc">${xesc(t)}</td>`;
    const header = `<tr>${HEADERS.map(th).join("")}</tr>`;
    const body = orderedRows(companies).map((r) => {
      if (r.blank) return `<tr><td></td><td></td></tr>`;
      if (r.label) return `<tr><td>${xesc(r.label)}</td><td></td></tr>`;
      return `<tr><td style="mso-number-format:'dd\\-mm\\-yyyy'">${xesc(r.date)}</td>` +
        `<td style="background-color:${r.color}">${xesc(r.name)}</td></tr>`;
    }).join("");
    return `<meta charset="utf-8"><table>${header}${body}</table>`;
  }

  /* Platte-tekst-variant (tab-gescheiden) als terugval en voor 'plakken zonder opmaak'. */
  function buildClipboardText(companies) {
    const lines = [HEADERS.join("\t")];
    for (const r of orderedRows(companies)) {
      if (r.blank) lines.push("");
      else if (r.label) lines.push(r.label);
      else lines.push(`${r.date}\t${r.name}`);
    }
    return lines.join("\n");
  }

  async function copyAgendaToClipboard(companies) {
    const html = buildClipboardHtml(companies || []);
    const text = buildClipboardText(companies || []);
    // Voorkeur: async Clipboard API met zowel HTML (kleuren) als platte tekst.
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new window.ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        })]);
        return true;
      } catch (e) { /* val terug op execCommand */ }
    }
    // Terugval: selecteer een tijdelijke opgemaakte div en kopieer via execCommand.
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    div.style.cssText = "position:fixed;left:-9999px;top:0;white-space:pre;";
    div.innerHTML = html;
    document.body.appendChild(div);
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(div);
    sel.removeAllRanges();
    sel.addRange(range);
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    sel.removeAllRanges();
    div.remove();
    return ok;
  }

  /* ---------- Publieke API ---------- */
  function buildAgendaXlsx(companies, sheetName) {
    const enc = new TextEncoder();
    const name = sheetName || "Cijferagenda";
    const files = [
      { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES) },
      { name: "_rels/.rels", data: enc.encode(RELS) },
      { name: "xl/workbook.xml", data: enc.encode(workbookXml(name)) },
      { name: "xl/_rels/workbook.xml.rels", data: enc.encode(WB_RELS) },
      { name: "xl/styles.xml", data: enc.encode(stylesXml()) },
      { name: "xl/worksheets/sheet1.xml", data: enc.encode(worksheetXml(companies || [])) },
    ];
    return zipStore(files);
  }

  function downloadAgendaXlsx(companies, now) {
    now = now || new Date();
    const sheetName = quarterLabel(now);
    const bytes = buildAgendaXlsx(companies, sheetName);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Boekagenda cijfers ${stamp}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  window.BoekagendaExport = {
    build: buildAgendaXlsx,
    download: downloadAgendaXlsx,
    copy: copyAgendaToClipboard,
    clipboardHtml: buildClipboardHtml,
  };
})();
