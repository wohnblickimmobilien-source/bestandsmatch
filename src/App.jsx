import React, { useState, useEffect, useMemo } from "react";

/* =========================================================================
   KONFIGURATION
   ========================================================================= */
const CONFIG = {
  markenName: "Wohnblick",
  toolName: "BestandsMatch",
  adminPasswort: "wohnblick2026", // <- dein Zugang. Bitte ändern.
  supabaseUrl: "https://yascpvuxlavzfardyssb.supabase.co",
  supabaseKey: "sb_publishable_iIyGA8S_RSZGSVofCcEbIA_KfZe-z0x",
};

const OBJEKTARTEN = [
  "Mehrfamilienhaus",
  "Wohn- und Geschäftshaus",
  "Zinshaus / Portfolio",
];

/* =========================================================================
   SUPABASE — schlanker REST-Client (kein SDK nötig)
   ========================================================================= */
const sbHeaders = (extra = {}) => ({
  apikey: CONFIG.supabaseKey,
  Authorization: `Bearer ${CONFIG.supabaseKey}`,
  "Content-Type": "application/json",
  ...extra,
});
async function sbList(table, order = "created_at.desc") {
  const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/${table}?select=*&order=${order}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`sbList ${table} failed`);
  return res.json();
}
async function sbInsert(table, row) {
  const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/${table}`, {
    method: "POST", headers: sbHeaders({ Prefer: "return=representation" }), body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`sbInsert ${table} failed`);
  return (await res.json())[0];
}
async function sbUpdate(table, id, row) {
  const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH", headers: sbHeaders({ Prefer: "return=representation" }), body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`sbUpdate ${table} failed`);
  return (await res.json())[0];
}
async function sbDelete(table, id) {
  const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", headers: sbHeaders() });
  if (!res.ok) throw new Error(`sbDelete ${table} failed`);
}

/* =========================================================================
   HILFSFUNKTIONEN
   ========================================================================= */
const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const fmtPct = (n) => `${n.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const rendite = (p) => (p.kaufpreis > 0 ? (Number(p.jahreskaltmiete) / Number(p.kaufpreis)) * 100 : 0);
const daysAgo = (iso) => (Date.now() - new Date(iso).getTime()) / 86400000;

/* Kurztext für WhatsApp/E-Mail — Eckdaten + Kurzbeschreibung als Pitch, ohne Bilder */
function buildPitchText(p, channel = "email") {
  const r = rendite(p);
  const ort = [p.plz, p.ort].filter(Boolean).join(" ") || "Lage auf Anfrage";
  const eckdaten = [
    `${p.einheiten || "–"} Wohneinheiten · Baujahr ${p.baujahr || "–"}`,
    `Kaufpreis: ${p.kaufpreis ? eur.format(p.kaufpreis) : "auf Anfrage"}`,
    `Bruttorendite: ${r ? r.toFixed(2) + " %" : "–"}`,
  ].join("\n");
  const pitch = (p.kurzbeschreibung || "").trim();

  if (channel === "whatsapp") {
    return [
      `*Neues Ankaufsangebot – ${p.objektart || "Mehrfamilienhaus"}*`,
      `${ort}`,
      "",
      eckdaten,
      pitch ? `\n${pitch}` : "",
      "",
      "Passt das zu Ihrem Ankaufsprofil? Ich schicke Ihnen gerne das vollständige Exposé mit Bildern.",
      "",
      "Beste Grüße",
      "Philipp Streib · Wohnblick Immobilien",
    ].filter(Boolean).join("\n");
  }

  return [
    "Guten Tag,",
    "",
    `aktuell steht ein neues Objekt zum Ankauf zur Verfügung, das zu Ihrem Suchprofil passen könnte:`,
    "",
    `${p.objektart || "Mehrfamilienhaus"} in ${ort}`,
    eckdaten,
    pitch ? `\n${pitch}` : "",
    "",
    "Bei Interesse sende ich Ihnen im Anschluss gerne das vollständige Exposé mit weiteren Details und Fotos zu.",
    "",
    "Beste Grüße",
    "Philipp Streib",
    "Wohnblick Immobilien",
  ].filter(Boolean).join("\n");
}
/* Telefonnummer für wa.me normalisieren (bestmögliche Heuristik) */
function waNummer(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "49" + d.slice(1);
  return d;
}

/* Matching-Logik: 0 / 0.5 / 1 pro Kriterium, gewichtet auf 100 % */
function bewerte(p, b) {
  const preis = Number(p.kaufpreis) || 0;
  const bmin = Number(b.budget_min) || 0;
  const bmax = Number(b.budget_max) || Infinity;
  let budget = 0;
  if (preis >= bmin && preis <= bmax) budget = 1;
  else if (preis >= bmin * 0.9 && preis <= bmax * 1.1) budget = 0.5;

  const tokens = (b.regionen || "").toLowerCase().split(/[,;]/).map((t) => t.trim()).filter(Boolean);
  const feld = `${p.plz || ""} ${(p.ort || "").toLowerCase()}`;
  let region = 0;
  if (tokens.length === 0 || tokens.some((t) => t.includes("bundesweit") || t.includes("deutschlandweit"))) region = 1;
  else if (tokens.some((t) => (/^\d+$/.test(t) ? (p.plz || "").startsWith(t) : feld.includes(t)))) region = 1;

  const emin = Number(b.einheiten_min) || 0;
  const e = Number(p.einheiten) || 0;
  let einheiten = 0;
  if (e >= emin) einheiten = 1;
  else if (e >= emin - 1) einheiten = 0.5;

  const arten = Array.isArray(b.objektarten) && b.objektarten.length ? b.objektarten : OBJEKTARTEN;
  const typ = arten.includes(p.objektart) ? 1 : 0;

  const rmin = Number(b.min_rendite) || 0;
  const r = rendite(p);
  let rend = 1;
  if (rmin > 0) { if (r >= rmin) rend = 1; else if (r >= rmin - 0.5) rend = 0.5; else rend = 0; }

  const score = Math.round(30 * budget + 25 * region + 20 * einheiten + 15 * typ + 10 * rend);
  const volltreffer = budget === 1 && region === 1 && typ === 1 && einheiten >= 0.5;
  return { score, volltreffer, chips: { budget, region, einheiten, typ, rend } };
}

/* =========================================================================
   ICONS
   ========================================================================= */
const IconBuilding = ({ lit }) => (
  <svg viewBox="0 0 32 32" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M6 27V12l10-6 10 6v15" stroke={lit ? "var(--gold)" : "var(--facade-line)"} strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M4 27h24" stroke={lit ? "var(--gold)" : "var(--facade-line)"} strokeWidth="1.3" strokeLinecap="round" />
    <rect x="10" y="14" width="3.4" height="3.4" stroke={lit ? "var(--gold)" : "var(--facade-line)"} strokeWidth="1" />
    <rect x="18.6" y="14" width="3.4" height="3.4" stroke={lit ? "var(--gold)" : "var(--facade-line)"} strokeWidth="1" />
    <rect x="10" y="19.5" width="3.4" height="3.4" stroke={lit ? "var(--gold)" : "var(--facade-line)"} strokeWidth="1" />
    <rect x="14.3" y="22" width="3.4" height="5" stroke={lit ? "var(--gold)" : "var(--facade-line)"} strokeWidth="1" />
    <rect x="18.6" y="19.5" width="3.4" height="3.4" stroke={lit ? "var(--gold)" : "var(--facade-line)"} strokeWidth="1" />
  </svg>
);
const IconPin = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden="true">
    <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);
const IconSearch = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
    <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

/* Score-Ring (statisch, performant für Listen) */
function ScoreRing({ score, size = 54 }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * c;
  const tone = score >= 80 ? "var(--gold-bright)" : score >= 60 ? "var(--gold)" : "var(--graphite)";
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="bm-ring" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="4" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth="4.5" strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x={size / 2} y={size / 2 + 5} textAnchor="middle" className="bm-ring-num">{score}</text>
    </svg>
  );
}

/* =========================================================================
   STYLES — BestandsKompass-Designsystem
   ========================================================================= */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&display=swap');
.bm-root{
  --bg:#121010; --panel:#1A1715; --panel-2:#211D1A;
  --ink:#EFEBE1; --graphite:#AFA795; --mute:#7E7768;
  --line:rgba(233,224,200,.10); --line-2:rgba(233,224,200,.06);
  --gold:#C9A85F; --gold-bright:#E4CD93; --gold-soft:#8C7538;
  --gold-line:rgba(201,168,95,.38); --gold-tint:rgba(201,168,95,.08);
  --facade-line:rgba(233,224,200,.30);
  --serif:'Hanken Grotesk',-apple-system,sans-serif;
  --sans:'Hanken Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --fig:'Fraunces',Georgia,serif;
  background:
    radial-gradient(70% 42% at 74% -6%, rgba(214,178,102,.18) 0%, rgba(206,168,96,.10) 26%, rgba(190,150,88,.04) 50%, rgba(190,150,88,0) 72%),
    linear-gradient(180deg, #1A1615 0%, #171413 18%, #141211 34%, var(--bg) 58%, var(--bg) 100%), var(--bg);
  background-attachment:fixed;
  color:var(--ink); font-family:var(--sans); line-height:1.5;
  min-height:100vh; -webkit-font-smoothing:antialiased;
}
.bm-root *{ box-sizing:border-box; }
.bm-wrap{ max-width:1180px; margin:0 auto; padding:0 22px; }
.bm-topbar{ position:sticky; top:0; z-index:10; display:flex; align-items:center; justify-content:space-between; padding:16px 22px; border-bottom:1px solid var(--line); background:rgba(18,16,16,.75); backdrop-filter:blur(10px); }
.bm-brand{ display:flex; align-items:center; gap:10px; }
.bm-brand b{ font-family:var(--serif); font-weight:700; font-size:15px; letter-spacing:.01em; }
.bm-brand span{ color:var(--mute); font-size:12px; }
.bm-dot{ width:7px; height:7px; border-radius:50%; background:var(--gold); flex:0 0 auto; box-shadow:0 0 0 0 rgba(201,168,95,.5); animation:bmLive 2.2s ease-out infinite; }
@keyframes bmLive{ 0%{ box-shadow:0 0 0 0 rgba(201,168,95,.5);} 70%{ box-shadow:0 0 0 7px rgba(201,168,95,0);} 100%{ box-shadow:0 0 0 0 rgba(201,168,95,0);} }

.bm-btn{ font-family:var(--sans); font-size:13.5px; font-weight:600; border-radius:8px; cursor:pointer; border:1px solid transparent; transition:all .18s ease; display:inline-flex; align-items:center; gap:8px; padding:10px 16px; }
.bm-btn.primary{ background:var(--gold); color:#1A1710; }
.bm-btn.primary:hover{ background:var(--gold-bright); }
.bm-btn.primary:disabled{ opacity:.45; cursor:not-allowed; }
.bm-btn.ghost{ background:transparent; color:var(--graphite); border-color:var(--line); }
.bm-btn.ghost:hover{ color:var(--ink); border-color:var(--gold-line); }
.bm-btn.sm{ padding:7px 12px; font-size:12.5px; }

.bm-tabs{ display:flex; gap:4px; padding:16px 0 0; border-bottom:1px solid var(--line); }
.bm-tab{ background:none; border:none; color:var(--mute); font-family:var(--sans); font-size:14px; font-weight:600; padding:11px 16px; cursor:pointer; border-bottom:2px solid transparent; display:flex; align-items:center; gap:8px; }
.bm-tab.on{ color:var(--ink); border-bottom-color:var(--gold); }
.bm-badge{ background:var(--panel-2); color:var(--gold); border-radius:20px; padding:1px 8px; font-size:11.5px; font-family:var(--sans); }
.bm-badge.alert{ background:rgba(224,138,111,.16); color:#e6a186; }

.bm-alertbar{ display:flex; align-items:center; justify-content:space-between; padding:13px 18px; border:1px solid var(--gold-line); background:var(--gold-tint); border-radius:10px; margin-bottom:20px; cursor:pointer; font-size:13.5px; color:var(--ink); font-weight:600; }
.bm-alertbar-arrow{ color:var(--gold); }

.bm-prop-clickable{ cursor:pointer; border-radius:8px; margin:-6px; padding:6px; transition:background .15s; }
.bm-prop-clickable:hover{ background:var(--panel-2); }

/* Eigentümer-Kontaktkarte (CRM-Stil) */
.bm-contactcard{ display:flex; align-items:center; gap:14px; padding:16px 18px; margin-top:26px; border:1px solid var(--gold-line); border-radius:12px; background:linear-gradient(135deg, var(--gold-tint), transparent); flex-wrap:wrap; }
.bm-contactcard-avatar{ width:44px; height:44px; border-radius:50%; background:var(--panel-2); border:1px solid var(--gold-line); display:flex; align-items:center; justify-content:center; font-family:var(--fig); font-size:16px; color:var(--gold); flex:0 0 auto; }
.bm-contactcard-body{ display:grid; gap:2px; flex:1; min-width:120px; }
.bm-contactcard-role{ font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--gold); }
.bm-contactcard-name{ font-family:var(--serif); font-size:15px; font-weight:700; color:var(--ink); }
.bm-contactcard-actions{ display:flex; gap:8px; flex-wrap:wrap; }
.bm-contactcard-actions a{ text-decoration:none; }

/* Karten klickbar & smooth */
.bm-card.clickable{ cursor:pointer; transition:transform .18s ease, border-color .18s ease, box-shadow .18s ease; }
.bm-card.clickable:hover{ border-color:var(--gold-line); transform:translateY(-2px); box-shadow:0 14px 30px -18px rgba(0,0,0,.55); }
.bm-card.clickable:active{ transform:translateY(0); }
.bm-btn{ transition:all .16s ease; }
.bm-btn:active{ transform:scale(.96); }
.bm-fchip{ transition:all .16s ease; }
.bm-tab{ transition:color .16s ease; }
.bm-send-row{ transition:all .16s ease; }
.bm-feed-item{ transition:transform .16s ease; }

/* Mobile-Anpassungen */
@media(max-width:700px){
  .bm-stats{ grid-template-columns:repeat(2,1fr); }
  .bm-between{ flex-direction:column; align-items:stretch; }
  .bm-between .bm-row{ margin-top: 10px; }
  .bm-tabs{ overflow-x:auto; flex-wrap:nowrap; -webkit-overflow-scrolling:touch; padding-bottom:2px; }
  .bm-tab{ flex:0 0 auto; white-space:nowrap; padding:11px 12px; }
  .bm-topbar{ padding:14px 16px; flex-wrap:wrap; gap:8px; }
  .bm-wrap{ padding:0 14px; }
  .bm-modal-panel{ padding:18px; max-height:92vh; }
  .bm-expose{ padding:26px 18px 60px; }
  .bm-expose-bar{ flex-wrap:wrap; gap:10px; padding:12px 16px; }
  .bm-contactcard{ flex-direction:column; align-items:flex-start; }
  .bm-contactcard-actions{ width:100%; }
  .bm-send-row{ flex-wrap:wrap; }
}
@media(max-width:420px){
  .bm-stats{ grid-template-columns:1fr; }
}

.bm-body{ padding:26px 0 70px; }
.bm-card{ background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:20px; margin-bottom:14px; }
.bm-empty{ text-align:center; color:var(--mute); padding:50px 20px; border:1px dashed var(--line); border-radius:12px; font-size:14px; }
.bm-err{ color:#e08a6f; font-size:13px; padding:12px 16px; border:1px solid #5c3b30; border-radius:10px; background:rgba(224,138,111,.08); margin-bottom:16px; }

/* Dashboard */
.bm-stats{ display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:var(--line); border:1px solid var(--line); border-radius:12px; overflow:hidden; margin-bottom:26px; }
.bm-stat{ background:var(--panel); padding:20px; }
.bm-stat-v{ font-family:var(--fig); font-weight:500; font-size:28px; color:var(--gold); letter-spacing:-.01em; line-height:1; }
.bm-stat-l{ font-size:12px; color:var(--graphite); margin-top:8px; }
.bm-section-h{ font-family:var(--serif); font-weight:700; font-size:16px; margin:0 0 14px; display:flex; align-items:center; justify-content:space-between; }

/* Feed */
.bm-feed-item{ display:flex; align-items:center; gap:16px; padding:14px 16px; border:1px solid var(--line); border-radius:10px; margin-bottom:9px; background:var(--panel-2); }
.bm-feed-item.hit{ border-color:var(--gold-line); background:var(--gold-tint); }
.bm-feed-info{ flex:1; min-width:0; }
.bm-feed-title{ font-size:14px; font-weight:600; color:var(--ink); }
.bm-feed-sub{ font-size:12px; color:var(--mute); margin-top:2px; }
.bm-feed-time{ font-size:11px; color:var(--mute); flex:0 0 auto; }

/* Suche & Filter */
.bm-toolbar{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:18px; }
.bm-search{ position:relative; flex:1; min-width:220px; }
.bm-search svg{ position:absolute; left:13px; top:50%; transform:translateY(-50%); color:var(--mute); }
.bm-search input{ width:100%; padding:10px 14px 10px 36px; }
.bm-filters{ display:flex; gap:8px; flex-wrap:wrap; }
.bm-fchip{ padding:8px 14px; border:1px solid var(--line); background:var(--panel); border-radius:20px; font-size:12.5px; color:var(--graphite); cursor:pointer; transition:all .15s; white-space:nowrap; }
.bm-fchip:hover{ border-color:var(--gold-line); color:var(--ink); }
.bm-fchip.on{ background:var(--gold-tint); color:var(--gold-bright); border-color:var(--gold); }

label.bm-f{ display:block; font-size:11.5px; color:var(--mute); margin-bottom:5px; font-weight:600; letter-spacing:.03em; text-transform:uppercase; }
.bm-root input, .bm-root select, .bm-root textarea{ width:100%; background:var(--panel-2); border:1px solid var(--line); color:var(--ink); border-radius:8px; padding:10px 12px; font:inherit; font-size:14px; }
.bm-root input:focus, .bm-root select:focus, .bm-root textarea:focus{ outline:none; border-color:var(--gold-soft); }
.bm-grid{ display:grid; gap:12px; }
.bm-row{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.bm-between{ display:flex; justify-content:space-between; align-items:flex-start; gap:14px; }
.bm-muted{ color:var(--graphite); }
.bm-h1{ font-family:var(--serif); font-size:22px; font-weight:700; margin:0; }
.bm-h2{ font-family:var(--serif); font-size:15.5px; font-weight:700; margin:0 0 2px; }
.bm-small{ font-size:12.5px; }
@media(min-width:640px){ .bm-cols2{ grid-template-columns:1fr 1fr; } .bm-cols3{ grid-template-columns:1fr 1fr 1fr; } }

/* Objekt-Karte */
.bm-prop-card{ display:flex; gap:14px; align-items:flex-start; }
.bm-prop-thumb{ width:46px; height:46px; flex:0 0 auto; border:1px solid var(--line); border-radius:8px; display:flex; align-items:center; justify-content:center; background:var(--panel-2); }
.bm-prop-body{ flex:1; min-width:0; }
.bm-prop-ort{ display:flex; align-items:center; gap:5px; font-size:12.5px; color:var(--graphite); margin-top:2px; }
.bm-prop-ort svg{ color:var(--gold); flex:0 0 auto; }
.bm-kpis{ display:grid; grid-template-columns:repeat(5,1fr); gap:1px; background:var(--line); border:1px solid var(--line); border-radius:8px; overflow:hidden; margin-top:14px; }
.bm-kpi{ background:var(--panel-2); padding:11px 10px; }
.bm-kpi span{ display:block; font-size:10px; letter-spacing:.03em; text-transform:uppercase; color:var(--mute); }
.bm-kpi strong{ display:block; font-family:var(--fig); font-size:14.5px; color:var(--ink); margin-top:4px; font-weight:500; }
@media(max-width:700px){ .bm-kpis{ grid-template-columns:repeat(3,1fr); } }

/* Käufer-Karte */
.bm-buyer-card{ display:flex; align-items:center; gap:16px; }
.bm-buyer-avatar{ width:40px; height:40px; border-radius:50%; background:var(--panel-2); border:1px solid var(--gold-line); display:flex; align-items:center; justify-content:center; font-family:var(--fig); font-size:14px; color:var(--gold); flex:0 0 auto; }
.bm-buyer-body{ flex:1; min-width:0; }
.bm-buyer-tags{ display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
.bm-tag{ font-size:11.5px; color:var(--graphite); border:1px solid var(--line); border-radius:20px; padding:4px 10px; }

/* Chips (Kriterien-Erfüllung) */
.bm-chip{ display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:600; padding:4px 9px; border-radius:20px; border:1px solid var(--line); color:var(--mute); }
.bm-chip.on{ color:var(--ink); border-color:var(--gold-soft); }
.bm-chip.on::before{ content:"✓"; color:var(--gold); }
.bm-chip.half{ color:var(--gold-soft); }
.bm-tier{ font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; }
.bm-tier.voll{ color:var(--gold-bright); } .bm-tier.gut{ color:var(--gold); } .bm-tier.teil{ color:var(--mute); }
.bm-ring-num{ font-family:var(--fig); font-size:16px; fill:var(--ink); font-weight:500; }

/* Match-Zeile */
.bm-match-row{ border:1px solid var(--line); border-radius:10px; padding:14px; background:var(--panel-2); margin-bottom:9px; }
.bm-match-row.hit{ border-color:var(--gold-line); background:var(--gold-tint); }

.bm-divider{ height:1px; background:var(--line); margin:14px 0; }

/* Gate */
.bm-gate{ min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
.bm-gatecard{ width:100%; max-width:380px; text-align:center; }
.bm-spin{ width:22px; height:22px; border-radius:50%; border:2px solid var(--line); border-top-color:var(--gold); animation:bmSpin .7s linear infinite; margin:0 auto; }
@keyframes bmSpin{ to{ transform:rotate(360deg); } }

/* Mehrfach-Bilder-Upload */
.bm-bildergrid{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
.bm-bild{ position:relative; aspect-ratio:1; border-radius:8px; overflow:hidden; border:1px solid var(--line); }
.bm-bild img{ width:100%; height:100%; object-fit:cover; display:block; }
.bm-bild-x{ position:absolute; top:5px; right:5px; width:22px; height:22px; border-radius:50%; border:none; background:rgba(10,9,8,.75); color:var(--ink); font-size:15px; line-height:1; cursor:pointer; }
.bm-bild-add{ aspect-ratio:1; border:1px dashed var(--line); border-radius:8px; display:flex; align-items:center; justify-content:center; text-align:center; font-size:11px; color:var(--mute); cursor:pointer; background:var(--panel-2); line-height:1.3; }
.bm-bild-add:hover{ border-color:var(--gold-line); color:var(--ink); }
@media(max-width:520px){ .bm-bildergrid{ grid-template-columns:repeat(3,1fr); } }
.bm-prop-thumb-img{ width:100%; height:100%; object-fit:cover; border-radius:8px; }

/* Mini-Exposé */
.bm-expose-overlay{ position:fixed; inset:0; z-index:50; background:var(--bg); overflow-y:auto; }
.bm-expose-bar{ position:sticky; top:0; z-index:2; display:flex; justify-content:space-between; padding:14px 22px; border-bottom:1px solid var(--line); background:rgba(18,16,16,.9); backdrop-filter:blur(8px); }
.bm-expose{ max-width:720px; margin:0 auto; padding:40px 28px 70px; }
.bm-expose-head{ display:flex; align-items:center; justify-content:space-between; padding-bottom:16px; border-bottom:1px solid var(--gold-line); }
.bm-expose-brand{ font-family:var(--serif); font-weight:700; font-size:15px; }
.bm-expose-tag{ font-size:10.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--gold); }
.bm-expose-title{ font-family:var(--fig); font-weight:500; font-size:clamp(26px,4vw,34px); margin:22px 0 0; letter-spacing:-.01em; }
.bm-expose-addr{ font-size:14px; color:var(--graphite); margin:8px 0 0; }
.bm-expose-imgs{ display:grid; grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); gap:10px; margin-top:22px; }
.bm-expose-imgs img{ width:100%; height:160px; object-fit:cover; border-radius:8px; border:1px solid var(--line); }
.bm-expose-desc{ font-size:14.5px; color:var(--ink); line-height:1.7; margin-top:22px; }
.bm-expose-kpis{ display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:var(--line); border:1px solid var(--line); border-radius:8px; overflow:hidden; margin-top:26px; }
.bm-expose-kpis > div{ background:var(--panel); padding:14px; }
.bm-expose-kpis span{ display:block; font-size:10px; letter-spacing:.03em; text-transform:uppercase; color:var(--mute); }
.bm-expose-kpis strong{ display:block; font-family:var(--fig); font-size:15px; color:var(--ink); margin-top:5px; font-weight:500; }
.bm-expose-kpis strong.gold{ color:var(--gold); }
.bm-expose-foot{ display:flex; justify-content:space-between; margin-top:34px; padding-top:16px; border-top:1px solid var(--line-2); font-size:11.5px; color:var(--mute); }
@media(max-width:520px){ .bm-expose-imgs{ grid-template-columns:1fr; } .bm-expose-kpis{ grid-template-columns:repeat(2,1fr); } }

/* Versand-Modal */
.bm-modal-backdrop{ position:fixed; inset:0; z-index:60; background:rgba(8,7,6,.72); display:flex; align-items:center; justify-content:center; padding:20px; }
.bm-modal-panel{ width:100%; max-width:640px; max-height:88vh; overflow-y:auto; background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:24px; }
.bm-modal-head{ display:flex; justify-content:space-between; align-items:flex-start; gap:14px; }
.bm-send-list{ display:grid; gap:8px; margin-top:12px; max-height:280px; overflow-y:auto; }
.bm-send-row{ display:flex; align-items:center; gap:12px; padding:10px 12px; border:1px solid var(--line); border-radius:8px; background:var(--panel-2); cursor:pointer; }
.bm-send-row.on{ border-color:var(--gold-line); background:var(--gold-tint); }
.bm-send-row input{ width:16px; height:16px; accent-color:var(--gold); flex:0 0 auto; }
.bm-send-info{ flex:1; min-width:0; display:grid; gap:2px; }
.bm-send-name{ font-size:13.5px; font-weight:600; color:var(--ink); }
.bm-send-meta{ font-size:11.5px; color:var(--mute); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bm-btn.lg{ padding:13px 20px; font-size:14.5px; }

@media print{
  .bm-topbar, .bm-tabs, .bm-expose-bar{ display:none !important; }
  .bm-root{ background:#fff !important; color:#111 !important; }
  .bm-expose-overlay{ position:static; }
  .bm-expose{ max-width:none; padding:0; }
  .bm-expose-title, .bm-expose-desc, .bm-expose-addr{ color:#111 !important; }
  .bm-expose-kpis > div{ background:#f7f5f0 !important; border-color:#ddd !important; }
  .bm-expose-kpis strong, .bm-expose-brand{ color:#111 !important; }
}
`;

/* =========================================================================
   OBJEKT-FORMULAR
   ========================================================================= */
const leeresObjekt = {
  titel: "", objektart: OBJEKTARTEN[0], strasse: "", plz: "", ort: "",
  einheiten: "", kaufpreis: "", wohnflaeche: "", jahreskaltmiete: "",
  baujahr: "", zustand: "gepflegt", notiz: "", kurzbeschreibung: "",
  bilder: [], status: "ungeprüft",
  kontakt_name: "", kontakt_telefon: "", kontakt_email: "",
};

const MAX_BILDER = 8;

/* Bild client-seitig verkleinern, bevor es als Base64 gespeichert wird */
function resizeImage(file, maxW = 1000, quality = 0.68) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lesefehler"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Bildfehler"));
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function BilderUpload({ bilder, onChange }) {
  const [busy, setBusy] = useState(false);
  const handle = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setBusy(true);
    const platz = Math.max(0, MAX_BILDER - bilder.length);
    const nutzbar = files.slice(0, platz);
    try {
      const resized = await Promise.all(nutzbar.map((f) => resizeImage(f)));
      onChange([...bilder, ...resized]);
    } catch { /* einzelne fehlerhafte Dateien werden ignoriert */ }
    setBusy(false);
    e.target.value = "";
  };
  const remove = (i) => onChange(bilder.filter((_, idx) => idx !== i));

  return (
    <div>
      <label className="bm-f">Bilder ({bilder.length}/{MAX_BILDER})</label>
      <div className="bm-bildergrid">
        {bilder.map((b, i) => (
          <div className="bm-bild" key={i}>
            <img src={b} alt="" />
            <button className="bm-bild-x" onClick={() => remove(i)} aria-label="Entfernen">×</button>
          </div>
        ))}
        {bilder.length < MAX_BILDER && (
          <label className="bm-bild-add" htmlFor="bm-bilder-input">
            {busy ? <span className="bm-spin" style={{ width: 18, height: 18 }} /> : <span>+ Bilder<br />wählen</span>}
          </label>
        )}
      </div>
      <input id="bm-bilder-input" type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handle} />
    </div>
  );
}

function ObjektForm({ initial, onSave, onCancel, saving }) {
  const [f, setF] = useState(initial || leeresObjekt);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const r = rendite(f);
  return (
    <div className="bm-card">
      <div className="bm-grid bm-cols2">
        <div><label className="bm-f">Bezeichnung</label>
          <input value={f.titel} onChange={set("titel")} placeholder="z. B. MFH Musterstraße 12" /></div>
        <div><label className="bm-f">Objektart</label>
          <select value={f.objektart} onChange={set("objektart")}>{OBJEKTARTEN.map((o) => <option key={o}>{o}</option>)}</select></div>
      </div>
      <div className="bm-grid bm-cols2" style={{ marginTop: 12 }}>
        <div><label className="bm-f">Straße & Hausnummer</label><input value={f.strasse} onChange={set("strasse")} placeholder="Musterstraße 12" /></div>
        <div><label className="bm-f">PLZ & Ort</label>
          <div className="bm-row" style={{ gap: 8 }}>
            <input style={{ maxWidth: 100 }} value={f.plz} onChange={set("plz")} placeholder="PLZ" />
            <input value={f.ort} onChange={set("ort")} placeholder="Ort" />
          </div>
        </div>
      </div>
      <div className="bm-grid bm-cols3" style={{ marginTop: 12 }}>
        <div><label className="bm-f">Wohneinheiten</label><input type="number" value={f.einheiten} onChange={set("einheiten")} /></div>
        <div><label className="bm-f">Kaufpreis / Marktwert (€)</label><input type="number" value={f.kaufpreis} onChange={set("kaufpreis")} /></div>
        <div><label className="bm-f">Jahresnettokaltmiete (€)</label><input type="number" value={f.jahreskaltmiete} onChange={set("jahreskaltmiete")} /></div>
      </div>
      <div className="bm-grid bm-cols3" style={{ marginTop: 12 }}>
        <div><label className="bm-f">Wohnfläche (m²)</label><input type="number" value={f.wohnflaeche} onChange={set("wohnflaeche")} /></div>
        <div><label className="bm-f">Baujahr</label><input type="number" value={f.baujahr} onChange={set("baujahr")} /></div>
        <div><label className="bm-f">Bruttorendite</label><input readOnly value={r ? r.toFixed(2) + " %" : "—"} /></div>
      </div>
      <div style={{ marginTop: 12 }}><label className="bm-f">Zustand</label>
        <select value={f.zustand} onChange={set("zustand")}><option>saniert</option><option>gepflegt</option><option>Instandhaltungsstau</option></select></div>
      <div style={{ marginTop: 12 }}>
        <label className="bm-f">Kurzbeschreibung (für das Exposé)</label>
        <textarea rows={3} maxLength={420} value={f.kurzbeschreibung} onChange={set("kurzbeschreibung")}
          placeholder="Kurzer Pitch: Lage, Besonderheiten, Zustand, Potenzial …" />
        <p className="bm-muted" style={{ fontSize: 11, marginTop: 4 }}>{(f.kurzbeschreibung || "").length}/420</p>
      </div>
      <div style={{ marginTop: 4 }}>
        <BilderUpload bilder={f.bilder || []} onChange={(v) => setF({ ...f, bilder: v })} />
      </div>
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
        <label className="bm-f">Eigentümer-Kontakt (intern, nicht im Exposé)</label>
        <div className="bm-grid bm-cols3">
          <input value={f.kontakt_name} onChange={set("kontakt_name")} placeholder="Name" />
          <input value={f.kontakt_telefon} onChange={set("kontakt_telefon")} placeholder="Telefon" />
          <input value={f.kontakt_email} onChange={set("kontakt_email")} placeholder="E-Mail" />
        </div>
      </div>
      <div style={{ marginTop: 12 }}><label className="bm-f">Notiz (intern, nicht im Exposé)</label><textarea rows={2} value={f.notiz} onChange={set("notiz")} /></div>
      <div className="bm-row" style={{ marginTop: 16 }}>
        <button className="bm-btn primary" disabled={saving} onClick={() => onSave(f)}>{saving ? "Speichert …" : "Objekt speichern"}</button>
        <button className="bm-btn ghost" onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  );
}

/* =========================================================================
   ÜBERSICHT (DASHBOARD)
   ========================================================================= */
function Dashboard({ properties, buyers, allMatches, pendingCount, setTab }) {
  const neueKaeufer7 = buyers.filter((b) => b.created_at && daysAgo(b.created_at) <= 7).length;
  const offeneVoll = allMatches.filter((m) => m.volltreffer).length;
  const feed = allMatches
    .filter((m) => m.score >= 60)
    .sort((a, z) => (z.b.created_at || "").localeCompare(a.b.created_at || "") || z.score - a.score)
    .slice(0, 8);

  return (
    <>
      {pendingCount > 0 && (
        <div className="bm-alertbar" onClick={() => setTab("pruefung")}>
          <span>{pendingCount} {pendingCount === 1 ? "Objekt wartet" : "Objekte warten"} auf Prüfung</span>
          <span className="bm-alertbar-arrow">→</span>
        </div>
      )}
      <div className="bm-stats">
        <div className="bm-stat"><div className="bm-stat-v">{properties.length}</div><div className="bm-stat-l">Objekte im Bestand</div></div>
        <div className="bm-stat"><div className="bm-stat-v">{buyers.length}</div><div className="bm-stat-l">Käufer gesamt</div></div>
        <div className="bm-stat"><div className="bm-stat-v">{offeneVoll}</div><div className="bm-stat-l">Offene Volltreffer</div></div>
        <div className="bm-stat"><div className="bm-stat-v">{neueKaeufer7}</div><div className="bm-stat-l">Neue Käufer (7 Tage)</div></div>
      </div>

      <div className="bm-h2" style={{ marginBottom: 14 }}>Neueste Übereinstimmungen</div>
      {feed.length === 0 ? (
        <div className="bm-empty">Noch keine relevanten Übereinstimmungen. Sobald Objekte und Käufer zusammenpassen, erscheinen sie hier.</div>
      ) : (
        feed.map((m, i) => (
          <div className={"bm-feed-item" + (m.volltreffer ? " hit" : "")} key={i}>
            <ScoreRing score={m.score} size={44} />
            <div className="bm-feed-info">
              <div className="bm-feed-title">{m.p.titel || "Ohne Bezeichnung"} <span className="bm-muted">↔</span> {m.b.name || "Ohne Namen"}</div>
              <div className="bm-feed-sub">{m.p.ort || m.p.plz} · {m.volltreffer ? "Volltreffer" : "Guter Match"}</div>
            </div>
            {m.b.created_at && <span className="bm-feed-time">{Math.round(daysAgo(m.b.created_at))} Tg.</span>}
          </div>
        ))
      )}

      <div className="bm-row" style={{ marginTop: 20 }}>
        <button className="bm-btn ghost sm" onClick={() => setTab("objekte")}>+ Objekt anlegen</button>
        <button className="bm-btn ghost sm" onClick={() => setTab("matches")}>Alle Matches ansehen</button>
      </div>
    </>
  );
}

/* =========================================================================
   VERSAND (Käufer auswählen, WhatsApp / E-Mail)
   ========================================================================= */
function SendModal({ p, buyers, matchesFor, channel, onClose }) {
  const ranked = useMemo(() => {
    const withScore = buyers.map((b) => ({ b, ...bewerte(p, b) }));
    return withScore.sort((a, z) => z.score - a.score);
  }, [buyers, p]);

  const [selected, setSelected] = useState(() => new Set(ranked.filter((m) => m.score >= 60).map((m) => m.b.id)));
  const [q, setQ] = useState("");
  const [text, setText] = useState(() => buildPitchText(p, channel));
  useEffect(() => { setText(buildPitchText(p, channel)); }, [p.id, channel]);
  const subject = `Ankaufsangebot: ${p.titel || p.objektart || "Mehrfamilienhaus"} in ${p.ort || p.plz || ""}`;

  const filtered = ranked.filter((m) => {
    if (!q.trim()) return true;
    return `${m.b.name || ""} ${m.b.email || ""}`.toLowerCase().includes(q.toLowerCase());
  });

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectMatched = () => setSelected(new Set(ranked.filter((m) => m.score >= 60).map((m) => m.b.id)));
  const selectAll = () => setSelected(new Set(ranked.map((m) => m.b.id)));
  const selectNone = () => setSelected(new Set());

  const selectedBuyers = ranked.filter((m) => selected.has(m.b.id)).map((m) => m.b);
  const emailReady = selectedBuyers.filter((b) => b.email);

  const sendBulkEmail = () => {
    const addrs = emailReady.map((b) => b.email);
    const params = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    const url = addrs.length === 1
      ? `mailto:${addrs[0]}?${params}`
      : `mailto:?bcc=${addrs.join(",")}&${params}`;
    window.open(url, "_blank");
  };
  const sendSingleEmail = (b) => {
    window.open(`mailto:${b.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`, "_blank");
  };
  const sendWhatsapp = (b) => {
    const num = waNummer(b.telefon);
    if (!num) return;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`, "_blank");
  };

  return (
    <div className="bm-modal-backdrop" onClick={onClose}>
      <div className="bm-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bm-modal-head">
          <div>
            <p className="bm-h2">{channel === "whatsapp" ? "Per WhatsApp senden" : "Per E-Mail senden"}</p>
            <p className="bm-muted bm-small">{p.titel || "Objekt"} · {p.plz} {p.ort}</p>
          </div>
          <button className="bm-btn ghost sm" onClick={onClose}>Schließen</button>
        </div>

        <label className="bm-f" style={{ marginTop: 16 }}>Nachricht (Eckdaten, ohne Bilder)</label>
        <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} style={{ fontFamily: "inherit", fontSize: 13.5 }} />

        <div className="bm-row" style={{ marginTop: 16, justifyContent: "space-between" }}>
          <p className="bm-h2" style={{ marginBottom: 0 }}>Empfänger auswählen</p>
          <div className="bm-row">
            <button className="bm-btn ghost sm" onClick={selectMatched}>Nur Matches</button>
            <button className="bm-btn ghost sm" onClick={selectAll}>Alle</button>
            <button className="bm-btn ghost sm" onClick={selectNone}>Keine</button>
          </div>
        </div>
        <div className="bm-search" style={{ marginTop: 10 }}><IconSearch /><input placeholder="Käufer suchen …" value={q} onChange={(e) => setQ(e.target.value)} /></div>

        <div className="bm-send-list">
          {filtered.length === 0 && <p className="bm-muted bm-small" style={{ padding: "10px 0" }}>Keine Käufer gefunden.</p>}
          {filtered.map((m) => {
            const on = selected.has(m.b.id);
            const tier = m.volltreffer ? "voll" : m.score >= 60 ? "gut" : m.score > 0 ? "teil" : null;
            return (
              <label className={"bm-send-row" + (on ? " on" : "")} key={m.b.id}>
                <input type="checkbox" checked={on} onChange={() => toggle(m.b.id)} />
                <div className="bm-send-info">
                  <span className="bm-send-name">{m.b.name || "Ohne Namen"}</span>
                  <span className="bm-send-meta">{m.b.telefon || "kein Telefon"} · {m.b.email || "keine E-Mail"}</span>
                </div>
                {tier && <span className={"bm-tier " + tier}>{m.volltreffer ? "Volltreffer" : m.score >= 60 ? "Match" : "Teilweise"}</span>}
                {channel === "whatsapp" && on && (
                  <button className="bm-btn primary sm" disabled={!m.b.telefon} onClick={(e) => { e.preventDefault(); sendWhatsapp(m.b); }}>WhatsApp öffnen</button>
                )}
                {channel === "email" && on && (
                  <button className="bm-btn ghost sm" disabled={!m.b.email} onClick={(e) => { e.preventDefault(); sendSingleEmail(m.b); }}>Einzeln</button>
                )}
              </label>
            );
          })}
        </div>

        {channel === "email" ? (
          <button className="bm-btn primary lg" style={{ width: "100%", justifyContent: "center", marginTop: 16 }}
            disabled={emailReady.length === 0} onClick={sendBulkEmail}>
            E-Mail öffnen ({emailReady.length} Empfänger{emailReady.length > 1 ? ", BCC" : ""})
          </button>
        ) : (
          <p className="bm-muted bm-small" style={{ marginTop: 14 }}>
            WhatsApp erlaubt keinen Sammelversand — klicken Sie bei jedem ausgewählten Käufer auf „WhatsApp öffnen".
          </p>
        )}
      </div>
    </div>
  );
}


function ExposeModal({ p, onClose }) {
  const r = rendite(p);
  return (
    <div className="bm-expose-overlay">
      <div className="bm-expose-bar">
        <button className="bm-btn ghost sm" onClick={onClose}>Schließen</button>
        <button className="bm-btn primary sm" onClick={() => window.print()}>Als PDF speichern</button>
      </div>
      <div className="bm-expose">
        <div className="bm-expose-head">
          <span className="bm-expose-brand">{CONFIG.markenName}</span>
          <span className="bm-expose-tag">Vertrauliches Kurzexposé</span>
        </div>
        <h1 className="bm-expose-title">{p.titel || "Mehrfamilienhaus"}</h1>
        <p className="bm-expose-addr">{[p.strasse, [p.plz, p.ort].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "Adresse auf Anfrage"}</p>

        {(p.bilder || []).length > 0 && (
          <div className="bm-expose-imgs">
            {p.bilder.map((b, i) => <img src={b} alt="" key={i} />)}
          </div>
        )}

        {p.kurzbeschreibung && <p className="bm-expose-desc">{p.kurzbeschreibung}</p>}

        <div className="bm-expose-kpis">
          <div><span>Objektart</span><strong>{p.objektart}</strong></div>
          <div><span>Wohneinheiten</span><strong>{p.einheiten || "—"}</strong></div>
          <div><span>Wohnfläche</span><strong>{p.wohnflaeche ? p.wohnflaeche + " m²" : "—"}</strong></div>
          <div><span>Baujahr</span><strong>{p.baujahr || "—"}</strong></div>
          <div><span>Kaufpreis</span><strong>{p.kaufpreis ? eur.format(p.kaufpreis) : "—"}</strong></div>
          <div><span>Jahreskaltmiete</span><strong>{p.jahreskaltmiete ? eur.format(p.jahreskaltmiete) : "—"}</strong></div>
          <div><span>Bruttorendite</span><strong className="gold">{r ? r.toFixed(2) + " %" : "—"}</strong></div>
          <div><span>Zustand</span><strong>{p.zustand || "—"}</strong></div>
        </div>

        <div className="bm-expose-foot">
          <span>Ihr Ansprechpartner: Philipp Streib · {CONFIG.markenName}</span>
          <span>{new Date().toLocaleDateString("de-DE")}</span>
        </div>
      </div>
    </div>
  );
}


/* =========================================================================
   OBJEKT-DETAILSEITE
   ========================================================================= */
function PropertyDetail({ p, matchesFor, onClose, onEdit, onDelete, onFreigeben, onExpose, onSend }) {
  const r = rendite(p);
  const ms = matchesFor(p);
  const pending = p.status === "ungeprüft";
  return (
    <div className="bm-expose-overlay">
      <div className="bm-expose-bar">
        <button className="bm-btn ghost sm" onClick={onClose}>← Zurück</button>
        <div className="bm-row">
          {pending && onFreigeben && <button className="bm-btn primary sm" onClick={onFreigeben}>Freigeben</button>}
          {onSend && <button className="bm-btn ghost sm" onClick={() => onSend("whatsapp")}>WhatsApp</button>}
          {onSend && <button className="bm-btn ghost sm" onClick={() => onSend("email")}>E-Mail</button>}
          {onExpose && <button className="bm-btn ghost sm" onClick={onExpose}>Exposé</button>}
          {onEdit && <button className="bm-btn ghost sm" onClick={onEdit}>Bearbeiten</button>}
          {onDelete && <button className="bm-btn ghost sm" onClick={onDelete}>Löschen</button>}
        </div>
      </div>
      <div className="bm-expose" style={{ maxWidth: 820 }}>
        <div className="bm-row" style={{ justifyContent: "space-between" }}>
          <span className={"bm-chip" + (pending ? "" : " on")}>{pending ? "Ungeprüft" : "Geprüft · im Listing"}</span>
        </div>
        <h1 className="bm-expose-title">{p.titel || "Mehrfamilienhaus"}</h1>
        <p className="bm-expose-addr">{[p.strasse, [p.plz, p.ort].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "Adresse auf Anfrage"} · {p.objektart}</p>

        {(p.bilder || []).length > 0 && (
          <div className="bm-expose-imgs">{p.bilder.map((b, i) => <img src={b} alt="" key={i} />)}</div>
        )}

        {p.kurzbeschreibung && <p className="bm-expose-desc">{p.kurzbeschreibung}</p>}

        <div className="bm-expose-kpis">
          <div><span>Objektart</span><strong>{p.objektart}</strong></div>
          <div><span>Wohneinheiten</span><strong>{p.einheiten || "—"}</strong></div>
          <div><span>Wohnfläche</span><strong>{p.wohnflaeche ? p.wohnflaeche + " m²" : "—"}</strong></div>
          <div><span>Baujahr</span><strong>{p.baujahr || "—"}</strong></div>
          <div><span>Kaufpreis</span><strong>{p.kaufpreis ? eur.format(p.kaufpreis) : "—"}</strong></div>
          <div><span>Jahreskaltmiete</span><strong>{p.jahreskaltmiete ? eur.format(p.jahreskaltmiete) : "—"}</strong></div>
          <div><span>Bruttorendite</span><strong className="gold">{r ? r.toFixed(2) + " %" : "—"}</strong></div>
          <div><span>Zustand</span><strong>{p.zustand || "—"}</strong></div>
        </div>

        {(p.kontakt_name || p.kontakt_telefon || p.kontakt_email) && (
          <div className="bm-contactcard">
            <span className="bm-contactcard-avatar">{(p.kontakt_name || "?").trim().charAt(0).toUpperCase()}</span>
            <div className="bm-contactcard-body">
              <span className="bm-contactcard-role">Eigentümer-Kontakt</span>
              <span className="bm-contactcard-name">{p.kontakt_name || "Ohne Namen"}</span>
            </div>
            <div className="bm-contactcard-actions">
              {p.kontakt_telefon && <a className="bm-btn ghost sm" href={`tel:${p.kontakt_telefon.replace(/\s+/g, "")}`}>Anrufen</a>}
              {p.kontakt_telefon && <a className="bm-btn ghost sm" href={`https://wa.me/${waNummer(p.kontakt_telefon)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
              {p.kontakt_email && <a className="bm-btn ghost sm" href={`mailto:${p.kontakt_email}`}>E-Mail</a>}
            </div>
          </div>
        )}

        {p.notiz && (
          <div className="bm-card" style={{ marginTop: 14 }}>
            <p className="bm-h2">Interne Notiz</p>
            <p className="bm-muted bm-small" style={{ whiteSpace: "pre-wrap" }}>{p.notiz}</p>
          </div>
        )}

        <div style={{ marginTop: 30 }}>
          <p className="bm-h2" style={{ marginBottom: 14 }}>Passende Käufer ({ms.filter((m) => m.score >= 60).length})</p>
          {ms.length === 0 ? (
            <p className="bm-muted bm-small">Noch kein passender Käufer in der Datenbank.</p>
          ) : (
            ms.map((m) => {
              const tier = m.volltreffer ? "voll" : m.score >= 60 ? "gut" : "teil";
              const tierText = m.volltreffer ? "Volltreffer" : m.score >= 60 ? "Guter Match" : "Teilweise";
              return (
                <div className={"bm-match-row" + (m.volltreffer ? " hit" : "")} key={m.b.id}>
                  <div className="bm-row" style={{ gap: 14 }}>
                    <ScoreRing score={m.score} />
                    <div>
                      <p className="bm-h2">{m.b.name || "Ohne Namen"}</p>
                      <p className="bm-muted bm-small">{m.b.email}{m.b.telefon ? " · " + m.b.telefon : ""}</p>
                      <span className={"bm-tier " + tier}>{tierText}</span>
                    </div>
                  </div>
                  <div className="bm-row" style={{ marginTop: 12 }}>
                    <Chip lbl="Budget" v={m.chips.budget} />
                    <Chip lbl="Region" v={m.chips.region} />
                    <Chip lbl="Einheiten" v={m.chips.einheiten} />
                    <Chip lbl="Typ" v={m.chips.typ} />
                    <Chip lbl="Rendite" v={m.chips.rend} />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="bm-expose-foot">
          <span>Angelegt: {p.created_at ? new Date(p.created_at).toLocaleDateString("de-DE") : "—"}</span>
          <span>{CONFIG.markenName}</span>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   PRÜFUNG (neu angelegte Objekte freigeben oder verwerfen)
   ========================================================================= */
function PruefungPanel({ pending, matchesFor, updProp, delProp }) {
  const [detail, setDetail] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const freigeben = async (p) => {
    setBusyId(p.id);
    try { await updProp(p.id, { ...p, status: "geprüft" }); } finally { setBusyId(null); }
  };
  const verwerfen = async (p) => {
    if (!window.confirm(`„${p.titel || "Objekt ohne Titel"}" wirklich verwerfen und löschen?`)) return;
    setBusyId(p.id);
    try { await delProp(p.id); } finally { setBusyId(null); }
  };

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <p className="bm-h1">Prüfung</p>
        <p className="bm-muted bm-small">Neu angelegte Objekte — freigeben, damit sie im Listing und im Matching erscheinen, oder als irrelevant verwerfen.</p>
      </div>

      {pending.length === 0 ? (
        <div className="bm-empty">Keine offenen Objekte zur Prüfung. Neu angelegte Objekte erscheinen automatisch hier.</div>
      ) : (
        pending.map((p) => (
          <div className="bm-card clickable" key={p.id} onClick={() => setDetail(p)}>
            <div className="bm-between">
              <div className="bm-prop-card">
                <span className="bm-prop-thumb">{p.bilder && p.bilder[0] ? <img src={p.bilder[0]} alt="" className="bm-prop-thumb-img" /> : <IconBuilding />}</span>
                <div className="bm-prop-body">
                  <p className="bm-h2">{p.titel || "Ohne Bezeichnung"}</p>
                  <span className="bm-prop-ort"><IconPin />{p.objektart} · {p.strasse ? p.strasse + ", " : ""}{p.plz} {p.ort}</span>
                </div>
              </div>
              <div className="bm-row" onClick={(e) => e.stopPropagation()}>
                <button className="bm-btn primary sm" disabled={busyId === p.id} onClick={() => freigeben(p)}>Freigeben</button>
                <button className="bm-btn ghost sm" disabled={busyId === p.id} onClick={() => verwerfen(p)}>Verwerfen</button>
              </div>
            </div>
            <div className="bm-kpis">
              <div className="bm-kpi"><span>Kaufpreis</span><strong>{p.kaufpreis ? eur.format(p.kaufpreis) : "—"}</strong></div>
              <div className="bm-kpi"><span>Einheiten</span><strong>{p.einheiten || "—"}</strong></div>
              <div className="bm-kpi"><span>Kaltmiete/J.</span><strong>{p.jahreskaltmiete ? eur.format(p.jahreskaltmiete) : "—"}</strong></div>
              <div className="bm-kpi"><span>Rendite</span><strong>{rendite(p) ? rendite(p).toFixed(1) + " %" : "—"}</strong></div>
              <div className="bm-kpi"><span>Baujahr</span><strong>{p.baujahr || "—"}</strong></div>
            </div>
          </div>
        ))
      )}

      {detail && (
        <PropertyDetail
          p={detail}
          matchesFor={matchesFor}
          onClose={() => setDetail(null)}
          onFreigeben={async () => { await freigeben(detail); setDetail(null); }}
          onDelete={() => { verwerfen(detail); setDetail(null); }}
        />
      )}
    </>
  );
}

function ObjektePanel({ properties, buyers, matchesFor, addProp, updProp, delProp }) {
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [artFilter, setArtFilter] = useState("Alle");
  const [expose, setExpose] = useState(null);
  const [sendCtx, setSendCtx] = useState(null); // { p, channel }
  const [detail, setDetail] = useState(null);

  const live = properties.filter((p) => p.status !== "ungeprüft");
  const filtered = live.filter((p) => {
    if (artFilter !== "Alle" && p.objektart !== artFilter) return false;
    if (!q.trim()) return true;
    const hay = `${p.titel || ""} ${p.ort || ""} ${p.plz || ""}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  const handleSave = async (f, id) => {
    setSaving(true);
    try { if (id) await updProp(id, f); else await addProp(f); setEdit(null); } finally { setSaving(false); }
  };

  return (
    <>
      <div className="bm-between" style={{ marginBottom: 16 }}>
        <div><p className="bm-h1">Objekte im Bestand</p><p className="bm-muted bm-small">Manuell gepflegt aus deinen Eigentümer-Leads.</p></div>
        {edit === null && <button className="bm-btn primary" onClick={() => setEdit("neu")}>+ Objekt anlegen</button>}
      </div>

      {edit === "neu" && <ObjektForm saving={saving} onCancel={() => setEdit(null)} onSave={(f) => handleSave(f, null)} />}

      {live.length > 0 && (
        <div className="bm-toolbar">
          <div className="bm-search"><IconSearch /><input placeholder="Suche nach Titel, Ort oder PLZ …" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="bm-filters">
            {["Alle", ...OBJEKTARTEN].map((a) => (
              <button key={a} className={"bm-fchip" + (artFilter === a ? " on" : "")} onClick={() => setArtFilter(a)}>{a}</button>
            ))}
          </div>
        </div>
      )}

      {live.length === 0 && edit === null && <div className="bm-empty">Noch keine geprüften Objekte. Neu angelegte Objekte erscheinen zunächst im Reiter „Prüfung".</div>}
      {live.length > 0 && filtered.length === 0 && <div className="bm-empty">Kein Objekt passt zu dieser Suche.</div>}

      {filtered.map((p) =>
        edit === p.id ? (
          <ObjektForm key={p.id} initial={p} saving={saving} onCancel={() => setEdit(null)} onSave={(f) => handleSave(f, p.id)} />
        ) : (
          <div className="bm-card clickable" key={p.id} onClick={() => setDetail(p)}>
            <div className="bm-between">
              <div className="bm-prop-card">
                <span className="bm-prop-thumb">{p.bilder && p.bilder[0] ? <img src={p.bilder[0]} alt="" className="bm-prop-thumb-img" /> : <IconBuilding />}</span>
                <div className="bm-prop-body">
                  <p className="bm-h2">{p.titel || "Ohne Bezeichnung"}</p>
                  <span className="bm-prop-ort"><IconPin />{p.objektart} · {p.strasse ? p.strasse + ", " : ""}{p.plz} {p.ort}</span>
                </div>
              </div>
              <div className="bm-row" onClick={(e) => e.stopPropagation()}>
                <span className="bm-chip on">{matchesFor(p).filter((m) => m.score >= 60).length} passende Käufer</span>
                <button className="bm-btn ghost sm" onClick={() => setSendCtx({ p, channel: "whatsapp" })}>WhatsApp</button>
                <button className="bm-btn ghost sm" onClick={() => setSendCtx({ p, channel: "email" })}>E-Mail</button>
                <button className="bm-btn ghost sm" onClick={() => setExpose(p)}>Exposé</button>
                <button className="bm-btn ghost sm" onClick={() => setEdit(p.id)}>Bearbeiten</button>
                <button className="bm-btn ghost sm" onClick={() => { if (window.confirm(`„${p.titel || "Objekt ohne Titel"}" wirklich unwiderruflich löschen?`)) delProp(p.id); }}>Löschen</button>
              </div>
            </div>
          </div>
        )
      )}
      {expose && <ExposeModal p={expose} onClose={() => setExpose(null)} />}
      {sendCtx && (
        <SendModal p={sendCtx.p} buyers={buyers} matchesFor={matchesFor} channel={sendCtx.channel} onClose={() => setSendCtx(null)} />
      )}
      {detail && (
        <PropertyDetail
          p={detail}
          matchesFor={matchesFor}
          onClose={() => setDetail(null)}
          onEdit={() => { setEdit(detail.id); setDetail(null); }}
          onDelete={() => { if (window.confirm(`„${detail.titel || "Objekt ohne Titel"}" wirklich unwiderruflich löschen?`)) { delProp(detail.id); setDetail(null); } }}
          onFreigeben={async () => { const saved = await updProp(detail.id, { ...detail, status: "geprüft" }); setDetail(saved); }}
          onExpose={() => { setExpose(detail); setDetail(null); }}
          onSend={(channel) => { setSendCtx({ p: detail, channel }); setDetail(null); }}
        />
      )}
    </>
  );
}

/* =========================================================================
   KÄUFER
   ========================================================================= */
function KaeuferPanel({ buyers }) {
  const [q, setQ] = useState("");
  const [artFilter, setArtFilter] = useState("Alle");

  const filtered = buyers.filter((b) => {
    if (artFilter !== "Alle" && !(Array.isArray(b.objektarten) && b.objektarten.includes(artFilter))) return false;
    if (!q.trim()) return true;
    const hay = `${b.name || ""} ${b.email || ""} ${b.regionen || b.region_label || ""}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <p className="bm-h1">Käufer-Datenbank</p>
        <p className="bm-muted bm-small">Läuft automatisch über deine Käufer-Landingpage ein.</p>
      </div>

      {buyers.length > 0 && (
        <div className="bm-toolbar">
          <div className="bm-search"><IconSearch /><input placeholder="Suche nach Name, E-Mail oder Region …" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="bm-filters">
            {["Alle", ...OBJEKTARTEN].map((a) => (
              <button key={a} className={"bm-fchip" + (artFilter === a ? " on" : "")} onClick={() => setArtFilter(a)}>{a}</button>
            ))}
          </div>
        </div>
      )}

      {buyers.length === 0 && <div className="bm-empty">Noch keine Käufer eingegangen.</div>}
      {buyers.length > 0 && filtered.length === 0 && <div className="bm-empty">Kein Käufer passt zu dieser Suche.</div>}

      {filtered.map((b) => (
        <div className="bm-card" key={b.id}>
          <div className="bm-between">
            <div className="bm-buyer-card">
              <span className="bm-buyer-avatar">{(b.name || "?").trim().charAt(0).toUpperCase()}</span>
              <div className="bm-buyer-body">
                <p className="bm-h2">{b.name || "Ohne Namen"}</p>
                <span className="bm-muted bm-small">{b.email}{b.telefon ? " · " + b.telefon : ""}{b.rolle ? " · " + b.rolle : ""}</span>
              </div>
            </div>
            <span className="bm-muted bm-small">{b.created_at ? new Date(b.created_at).toLocaleDateString("de-DE") : ""}</span>
          </div>
          <div className="bm-kpis">
            <div className="bm-kpi"><span>Budget</span><strong>{b.budget_min ? eur.format(b.budget_min) : "0"} – {b.budget_max ? eur.format(b.budget_max) : "offen"}</strong></div>
            <div className="bm-kpi"><span>Einheiten ab</span><strong>{b.einheiten_min || "—"}</strong></div>
            <div className="bm-kpi"><span>Min. Rendite</span><strong>{b.min_rendite ? b.min_rendite + " %" : "—"}</strong></div>
            <div className="bm-kpi"><span>Regionen</span><strong style={{ fontSize: 12.5 }}>{b.regionen || b.region_label || "bundesweit"}</strong></div>
          </div>
          <div className="bm-buyer-tags">
            {(b.objektarten || []).map((a) => <span className="bm-tag" key={a}>{a}</span>)}
            {b.bereitschaft && <span className="bm-tag">{b.bereitschaft}</span>}
            {b.verkauf && b.verkauf !== "Nein" && <span className="bm-tag" style={{ color: "var(--gold)", borderColor: "var(--gold-line)" }}>Eigener Verkauf: {b.verkauf}</span>}
          </div>
        </div>
      ))}
    </>
  );
}

/* =========================================================================
   MATCHES
   ========================================================================= */
function MatchesPanel({ properties, matchesFor }) {
  const [q, setQ] = useState("");
  const [minScore, setMinScore] = useState(0);

  const visibleProps = properties.filter((p) => {
    if (q.trim() && !`${p.titel || ""} ${p.ort || ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <p className="bm-h1">Übereinstimmungen</p>
        <p className="bm-muted bm-small">Für jedes Objekt die passenden Käufer, automatisch sortiert nach Passung.</p>
      </div>

      {properties.length === 0 ? (
        <div className="bm-empty">Leg zuerst Objekte an.</div>
      ) : (
        <>
          <div className="bm-toolbar">
            <div className="bm-search"><IconSearch /><input placeholder="Objekt suchen …" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="bm-filters">
              {[{ v: 0, l: "Alle" }, { v: 60, l: "Ab 60 %" }, { v: 100, l: "Nur Volltreffer" }].map((o) => (
                <button key={o.l} className={"bm-fchip" + (minScore === o.v ? " on" : "")} onClick={() => setMinScore(o.v)}>{o.l}</button>
              ))}
            </div>
          </div>

          {visibleProps.map((p) => {
            const ms = matchesFor(p).filter((m) => (minScore === 100 ? m.volltreffer : m.score >= minScore));
            return (
              <div className="bm-card" key={p.id}>
                <div className="bm-prop-card">
                  <span className="bm-prop-thumb"><IconBuilding /></span>
                  <div className="bm-prop-body">
                    <p className="bm-h2">{p.titel || "Ohne Bezeichnung"}</p>
                    <span className="bm-prop-ort"><IconPin />{p.plz} {p.ort} · {p.einheiten || "?"} Einheiten · {p.kaufpreis ? eur.format(p.kaufpreis) : "—"} · {rendite(p) ? rendite(p).toFixed(1) + " %" : "—"}</span>
                  </div>
                </div>
                <div className="bm-divider" />
                {ms.length === 0 ? (
                  <p className="bm-muted bm-small">Kein passender Käufer für diesen Filter.</p>
                ) : (
                  ms.map((m) => {
                    const tier = m.volltreffer ? "voll" : m.score >= 60 ? "gut" : "teil";
                    const tierText = m.volltreffer ? "Volltreffer" : m.score >= 60 ? "Guter Match" : "Teilweise";
                    return (
                      <div className={"bm-match-row" + (m.volltreffer ? " hit" : "")} key={m.b.id}>
                        <div className="bm-between">
                          <div className="bm-row" style={{ gap: 14 }}>
                            <ScoreRing score={m.score} />
                            <div>
                              <p className="bm-h2">{m.b.name || "Ohne Namen"}</p>
                              <p className="bm-muted bm-small">{m.b.email}{m.b.telefon ? " · " + m.b.telefon : ""}</p>
                              <span className={"bm-tier " + tier}>{tierText}</span>
                            </div>
                          </div>
                        </div>
                        <div className="bm-row" style={{ marginTop: 12 }}>
                          <Chip lbl="Budget" v={m.chips.budget} />
                          <Chip lbl="Region" v={m.chips.region} />
                          <Chip lbl="Einheiten" v={m.chips.einheiten} />
                          <Chip lbl="Typ" v={m.chips.typ} />
                          <Chip lbl="Rendite" v={m.chips.rend} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

const Chip = ({ lbl, v }) => (
  <span className={"bm-chip" + (v === 1 ? " on" : v === 0.5 ? " half" : "")}>{v === 0.5 ? "~ " : ""}{lbl}</span>
);

/* =========================================================================
   PASSWORT-GATE
   ========================================================================= */
function Gate({ onOk }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const go = () => (pw === CONFIG.adminPasswort ? onOk() : setErr(true));
  return (
    <div className="bm-gate"><div className="bm-gatecard">
      <div className="bm-brand" style={{ justifyContent: "center", marginBottom: 18 }}><span className="bm-dot" /><b>{CONFIG.toolName}</b></div>
      <div className="bm-card">
        <label className="bm-f" style={{ textAlign: "left" }}>Zugangspasswort</label>
        <input type="password" value={pw} autoFocus onChange={(e) => { setPw(e.target.value); setErr(false); }} onKeyDown={(e) => e.key === "Enter" && go()} />
        {err && <p className="bm-small" style={{ color: "#d98a6a", marginTop: 8, textAlign: "left" }}>Passwort stimmt nicht.</p>}
        <button className="bm-btn primary" style={{ marginTop: 14, width: "100%", justifyContent: "center" }} onClick={go}>Anmelden</button>
      </div>
      <p className="bm-muted bm-small" style={{ marginTop: 12 }}>Nur für internen Gebrauch · {CONFIG.markenName}</p>
    </div></div>
  );
}

/* =========================================================================
   ROOT
   ========================================================================= */
export default function BestandsMatch() {
  const [authed, setAuthed] = useState(false);
  const [properties, setProperties] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState("uebersicht");

  const loadAll = async (showSpinner) => {
    if (showSpinner) setSyncing(true);
    setError("");
    try {
      const [props, buys] = await Promise.all([sbList("objekte"), sbList("kaeufer")]);
      setProperties(props); setBuyers(buys);
    } catch { setError("Verbindung zur Datenbank fehlgeschlagen. Bitte Aktualisieren erneut versuchen."); }
    finally { setLoading(false); if (showSpinner) setSyncing(false); }
  };

  useEffect(() => {
    loadAll(false);
    const t = setInterval(() => loadAll(false), 15000);
    return () => clearInterval(t);
  }, []);

  const addProp = async (f) => { const clean = { ...f }; delete clean.id; const saved = await sbInsert("objekte", clean); setProperties((prev) => [saved, ...prev]); };
  const updProp = async (id, f) => { const clean = { ...f }; delete clean.id; const saved = await sbUpdate("objekte", id, clean); setProperties((prev) => prev.map((x) => (x.id === id ? saved : x))); return saved; };
  const delProp = async (id) => { await sbDelete("objekte", id); setProperties((prev) => prev.filter((x) => x.id !== id)); };

  const matchesFor = (p) => buyers.map((b) => ({ b, ...bewerte(p, b) })).filter((m) => m.score > 0).sort((a, z) => z.score - a.score);
  const liveProperties = properties.filter((p) => p.status !== "ungeprüft");
  const pendingProperties = properties.filter((p) => p.status === "ungeprüft");
  const allMatches = useMemo(() => {
    const out = [];
    liveProperties.forEach((p) => buyers.forEach((b) => { const m = bewerte(p, b); if (m.score > 0) out.push({ p, b, ...m }); }));
    return out;
  }, [liveProperties, buyers]);
  const totalVoll = allMatches.filter((m) => m.volltreffer).length;

  return (
    <div className="bm-root">
      <style>{CSS}</style>
      {!authed ? (
        <Gate onOk={() => setAuthed(true)} />
      ) : loading ? (
        <div className="bm-gate"><div className="bm-spin" /></div>
      ) : (
        <>
          <div className="bm-topbar">
            <div className="bm-brand"><span className="bm-dot" /><b>{CONFIG.toolName}</b><span>{CONFIG.markenName} · live</span></div>
            <button className="bm-btn ghost sm" onClick={() => loadAll(true)} disabled={syncing}>{syncing ? "Lädt …" : "Aktualisieren"}</button>
          </div>

          <div className="bm-wrap">
            {error && <div className="bm-err" style={{ marginTop: 16 }}>{error}</div>}
            <div className="bm-tabs">
              <button className={"bm-tab" + (tab === "uebersicht" ? " on" : "")} onClick={() => setTab("uebersicht")}>Übersicht</button>
              <button className={"bm-tab" + (tab === "objekte" ? " on" : "")} onClick={() => setTab("objekte")}>Objekte<span className="bm-badge">{liveProperties.length}</span></button>
              <button className={"bm-tab" + (tab === "pruefung" ? " on" : "")} onClick={() => setTab("pruefung")}>Prüfung{pendingProperties.length > 0 && <span className="bm-badge alert">{pendingProperties.length}</span>}</button>
              <button className={"bm-tab" + (tab === "kaeufer" ? " on" : "")} onClick={() => setTab("kaeufer")}>Käufer<span className="bm-badge">{buyers.length}</span></button>
              <button className={"bm-tab" + (tab === "matches" ? " on" : "")} onClick={() => setTab("matches")}>Matches{totalVoll > 0 && <span className="bm-badge">{totalVoll}</span>}</button>
            </div>

            <div className="bm-body">
              {tab === "uebersicht" && <Dashboard properties={liveProperties} buyers={buyers} allMatches={allMatches} pendingCount={pendingProperties.length} setTab={setTab} />}
              {tab === "objekte" && <ObjektePanel properties={properties} buyers={buyers} matchesFor={matchesFor} addProp={addProp} updProp={updProp} delProp={delProp} />}
              {tab === "pruefung" && <PruefungPanel pending={pendingProperties} matchesFor={matchesFor} updProp={updProp} delProp={delProp} />}
              {tab === "kaeufer" && <KaeuferPanel buyers={buyers} />}
              {tab === "matches" && <MatchesPanel properties={liveProperties} matchesFor={matchesFor} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
