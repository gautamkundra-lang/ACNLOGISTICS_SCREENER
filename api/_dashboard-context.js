// Shared knowledge about the Hormel Transportation dashboard.
// Used by api/chat.js to ground the Screener Copilot in what the dashboard shows.
// The static facts below mirror the dashboard UI; live numbers are layered on top
// from Vercel KV when available.

export const DASHBOARD_TABS = {
  overview: 'Overview — HTCI cost index, 8 transportation modes, and CPG KPIs',
  signals: 'Market Signals — 7 active market signal cards (reefer crunch, hurricane, Panama, etc.)',
  network: 'My Network — 10 critical Hormel freight lanes with spot rates and OTIF',
  actions: 'Action Hub — 7 prioritized recommendations + 6 escalation triggers',
  forecast: 'Rate Outlook — 12-week trend + 30-day base/bull/bear forecast per mode',
  sources: 'Sources — 16 live and reference data sources by category',
};

// Baseline figures shown on the dashboard. Live KV data overrides the headline rates.
export const STATIC_CONTEXT = `
TRANSPORTATION MODES (baseline figures, 30-day change):
- Reefer TL: $3.47/mi (+8.2%, HEADWIND, HIGH risk) — Applegate + Hormel Refrigerated. L:T ratio 8.2.
- Dry Van TL: $2.84/mi (+5.4%, HEADWIND, WATCH) — SPAM, canned, shelf-stable. L:T 5.8.
- LTL: $98.4/cwt (-1.2%, TAILWIND, EASING) — secondary & DSD distribution.
- Intermodal: $2.18/mi (+3.1%, HEADWIND, WATCH) — LA/LB to Midwest import drayage.
- Ocean FCL: $3,240/FEU (-8.3%, TAILWIND, buy window open) — SPAM ingredients from Asia.
- Air Freight: $4.82/kg (+4.2%, HEADWIND, WATCH) — emergency ingredient shortfalls.
- Rail Carload: $1.92/mi (+0.9%, NEUTRAL, STABLE) — grain & bulk ingredients.
- Parcel/DTC: $8.94/pkg (-0.6%, TAILWIND, STABLE) — Hormel.com + corporate gifting.

KEY KPIs:
- HTCI (Hormel Transportation Cost Index): 847.3 pts, +2.4% (5 of 8 modes rising).
- Monthly extra cost vs budget: +$420K.
- Walmart OTIF: 94.2% (target 98.5% — in penalty zone). Target OTIF: 96.1%.
- Tender rejection rate: 18.4%. Cold storage availability: 82%.
- Diesel fuel surcharge: $0.42/mi.

CRITICAL FREIGHT LANES (origin → destination, mode, spot, 30d change):
1. Austin MN → Walmart DC Sanger TX (Reefer, $3.82/mi, +9.2%)
2. Austin MN → Los Angeles CA (Reefer, $3.47/mi, +7.8%)
3. Rochelle IL → Northeast US (Reefer, $3.41/mi, +7.2%)
4. Austin MN → Walmart DC Winchester VA (Dry Van, $2.78/mi, +5.4%)
5. Fremont NE → Southeast US (Dry Van, $2.61/mi, -2.3%)
6. Shanghai CN → LA/LB Port (Ocean FCL, $3,240/FEU, -8.3%) — buy window
7. Monterrey MX → Austin MN (Cross-Border, $3,800/load, +9.1%)
8. LA/LB Port → Austin MN (Intermodal, $2,180/FEU, -2.1%)
9. Austin MN → Target DC Lacey WA (Reefer, $3.55/mi, +8.8%)
10. Stockton CA → Pacific Northwest (Dry Van, $2.95/mi, +4.8%)

PRIORITIZED ACTIONS (Action Hub):
CRITICAL (today): (1) Lock reefer capacity Aug-Oct — saves $180-240K. (2) Reroute SPAM/ingredient FCL Panama→Suez — prevents Q4 production gap.
HIGH (this week): (3) Pre-book Q4 ingredient FCL at soft ocean rates by July 20 — saves $0.8-1.4M. (4) Convert Monterrey protein sourcing to 6-month contract by July 20 — saves $280-420K/yr.
MEDIUM (30 days): (5) Renegotiate LTL rates — saves $140-220K/yr. (6) Modal shift Dry Van→Intermodal Austin to Southeast — saves $90-160K/yr.
LOW (60 days): (7) Audit parcel carrier mix for DTC/gifting — saves $60-100K/yr.

ESCALATION TRIGGERS (condition → current → response):
- Reefer TL >$4.00/mi → $3.82 (approaching) → lock contracts, approve $0.40/mi premium, escalate SVP.
- Walmart OTIF <95% → 94.2% (TRIGGERED) → dedicated reefer carrier, 5-day safety stock.
- Panama Canal surcharge >$600/FEU → $540 (active) → full Suez rerouting.
- Hurricane Cat 3+ within 200mi → Cat 1 approaching → pre-position 7-day inventory.
- Reefer rejection >25% → 18.4% (building) → activate backup carrier pool.
- Monterrey cross-border >$4,200/load → $3,800 → lock 6-month contract.

DATA SOURCES: DAT, FreightWaves SONAR, ACT Research (truckload); Drewry WCI, Freightos FBX, Xeneta (ocean); DrayNow, IANA, AAR, Cass Index (intermodal/rail/LTL); Freightos FAX, EIA, UPS/FedEx (air/fuel).
`;

function fmtLive(data) {
  if (!data) return 'No live refresh data available yet — using baseline figures above.';
  const lines = ['LIVE DATA (most recent daily refresh, overrides baseline where present):'];
  if (data.fetched_at) lines.push(`As of: ${data.fetched_at}`);
  if (data.reefer) lines.push(`- Reefer TL: $${data.reefer.rate}/mi (${data.reefer.src})`);
  if (data.dryvan) lines.push(`- Dry Van TL: $${data.dryvan.rate}/mi (${data.dryvan.src})`);
  if (data.diesel) lines.push(`- Diesel: $${data.diesel.price}/gal (${data.diesel.src})`);
  if (data.ocean_sh_la) lines.push(`- Ocean Shanghai-LA: $${data.ocean_sh_la.rate}/FEU (${data.ocean_sh_la.src})`);
  if (data.ltr_reefer) lines.push(`- Reefer load-to-truck ratio: ${data.ltr_reefer.ratio}`);
  if (data.tender_rej) lines.push(`- Tender rejection rate: ${data.tender_rej.pct}%`);
  if (data.ltl) lines.push(`- LTL: $${data.ltl.rate}/cwt`);
  if (data.disruptions && data.disruptions.length) lines.push(`- Active disruptions: ${data.disruptions.join('; ')}`);
  if (data.intel_summary) lines.push(`- Intelligence summary: ${data.intel_summary}`);
  return lines.join('\n');
}

export function buildSystemPrompt(liveData) {
  const tabList = Object.entries(DASHBOARD_TABS)
    .map(([k, v]) => `  #${k} — ${v}`)
    .join('\n');

  return `You are the "Screener Copilot" — an embedded assistant inside the Hormel Foods Transportation Cost Intelligence dashboard. You help a supply-chain / procurement user understand the freight market data, interpret the intelligence summary, decide what actions to take, and navigate the dashboard.

YOUR ROLE:
- Be a concise, decisive co-pilot. Lead with the answer, then the supporting data.
- Translate raw rates into business implications for Hormel (Walmart/Target OTIF, SPAM ingredients, Applegate reefer, Q4 holiday production).
- When a user should look at a specific part of the dashboard, name the tab and include its hash so the UI can offer to navigate. Use this exact format on its own line: [GOTO:overview] / [GOTO:signals] / [GOTO:network] / [GOTO:actions] / [GOTO:forecast] / [GOTO:sources]. Only emit a GOTO when navigation genuinely helps.
- When recommending actions, reference the specific Action Hub items and their dollar impact.
- If asked about something not in the data, say so plainly rather than inventing figures.
- Keep responses tight — usually 2-5 sentences or a short bulleted list. This is a sidebar chat, not a report.

DASHBOARD TABS AVAILABLE:
${tabList}

${STATIC_CONTEXT}

${fmtLive(liveData)}

Today's context: you are speaking with a Hormel transportation/procurement decision-maker who wants fast, actionable guidance.`;
}
