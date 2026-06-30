import { kv } from '@vercel/kv';

// Node serverless runtime (not edge): the grounded generation can take 30-50s,
// which exceeds the edge response limit. Node on Hobby allows up to 60s.
export const config = { maxDuration: 60 };

const LIVE_PROMPT = `You are the data engine for a freight market screener used by the CPG Foods transportation & procurement team. Search the web for CURRENT information (use live sources: DAT Freight, FreightWaves, EIA, Drewry, Freightos, plus reputable news for events) and return a single structured JSON object.

PART A — CURRENT RATES:
1. DAT reefer TL national average spot rate ($/mile) and 30-day % change
2. DAT dry van TL national average spot rate ($/mile) and 30-day % change
3. EIA latest weekly US national average diesel price ($/gallon)
4. Drewry World Container Index Shanghai→LA ($/FEU) and 30-day % change
5. Reefer national load-to-truck ratio (DAT/FreightWaves)
6. Tender rejection rate % (FreightWaves)
7. LTL rate index ($/cwt) if available (Cass)

PART B — EVENT RISK SCAN (this is critical): actively search for CURRENT and developing events in EACH of these categories that could move freight rates over the next 0–60 days. For each material event, capture which freight modes it affects and whether it pushes rates UP (headwind) or DOWN (tailwind):
- geopolitical: wars, sanctions, trade policy/tariffs, shipping-lane threats (e.g. Red Sea/Suez, Strait of Hormuz, Taiwan Strait)
- labor: port/rail/trucking strikes, union negotiations (ILA/ILWU/Teamsters), work stoppages, slowdowns
- weather: hurricanes/tropical systems, winter storms, flooding, wildfire, drought affecting waterways (e.g. Panama Canal draft)
- infrastructure: port congestion, canal constraints/transit limits, rail network issues, bridge/road closures
- fuel_energy: diesel/oil price shocks, refinery outages, fuel surcharge shifts
- regulatory: emissions rules, hours-of-service, drayage/clean-truck mandates, customs changes

PART C — RATE OUTLOOK that INCORPORATES the Part B events. For EACH mode (reefer, dryvan, ltl, imdl, ocean, air, rail, parcel) give a 30-day forecast as base/bull(rates fall, favorable)/bear(rates rise, unfavorable) numbers in that mode's native unit. Use your knowledge of historical freight-rate seasonality and typical patterns (e.g. produce season reefer tightening, Q4 holiday peak, Lunar New Year ocean slack) TOGETHER with the current events found via search to set realistic bull/base/bear levels — do not just echo the current rate.

For each mode also provide:
- "confidence": "high" | "medium" | "low" (how confident the 30-day call is).
- "driver_signals": the standard freight-rate driver framework. For EACH of these eight categories give a direction — "up" (pushing rates up / unfavorable), "down" (pushing rates down / favorable), or "neutral" — plus a short note: demand, capacity (carrier/equipment supply, L:T ratio, tender rejection), fuel (diesel/energy cost), seasonality, network (port/rail/cold-storage/ops), macro (GDP/rates/FX/trade), events (the Part B disruptions), market (contract-vs-spot spread, carrier operating ratios, leverage cycle).
Populate confidence AND the full 8-category driver_signals array for EVERY mode. The JSON below shows the complete shape only for "reefer" to save space — produce the same complete structure for all eight modes (do not leave driver_signals empty).

Then write a 2–3 sentence CPG Foods-specific intelligence summary covering rate direction, the most important active event(s), and the single most important action to take today.

Return ONLY strict, valid JSON — no markdown fences, no comments, no trailing commas, and do NOT use double-quote characters inside any string value (paraphrase or use single quotes). Keep notes short. This exact shape (units: reefer/dryvan/imdl/rail $/mi, ltl $/cwt, ocean/air per FEU or $/kg, parcel $/pkg — match the dashboard):
{
  "reefer": { "rate": 3.47, "chg_pct": 8.2, "src": "DAT", "asof": "YYYY-MM-DD" },
  "dryvan": { "rate": 2.84, "chg_pct": 5.4, "src": "DAT", "asof": "YYYY-MM-DD" },
  "diesel": { "price": 3.89, "src": "EIA", "asof": "YYYY-MM-DD" },
  "ocean_sh_la": { "rate": 3240, "chg_pct": -8.3, "src": "Drewry WCI", "asof": "YYYY-MM-DD" },
  "ltr_reefer": { "ratio": 8.2, "src": "DAT/FreightWaves", "asof": "YYYY-MM-DD" },
  "tender_rej": { "pct": 18.4, "src": "FreightWaves", "asof": "YYYY-MM-DD" },
  "ltl": { "rate": 98.4, "src": "Cass Index", "asof": "YYYY-MM-DD" },
  "events": [
    { "category": "geopolitical|labor|weather|infrastructure|fuel_energy|regulatory",
      "title": "short headline",
      "summary": "1-2 sentences on what is happening and the CPG Foods-relevant impact",
      "modes": ["reefer","ocean"],
      "direction": "headwind|tailwind|neutral",
      "severity": "high|watch|easing",
      "horizon": "e.g. 48-72 hrs / 30 days",
      "source": "source name" }
  ],
  "forecasts": {
    "reefer": { "base": 3.65, "bull": 3.52, "bear": 3.92, "confidence": "medium",
      "drivers": ["concise event/seasonal reason", "..."],
      "driver_signals": [
        { "cat": "demand", "dir": "up", "note": "short note" },
        { "cat": "capacity", "dir": "up", "note": "L:T elevated" },
        { "cat": "fuel", "dir": "up", "note": "diesel rising" },
        { "cat": "seasonality", "dir": "up", "note": "produce season" },
        { "cat": "network", "dir": "neutral", "note": "" },
        { "cat": "macro", "dir": "neutral", "note": "" },
        { "cat": "events", "dir": "up", "note": "tie to a Part B event" },
        { "cat": "market", "dir": "up", "note": "spot above contract" }
      ] },
    "dryvan": { "base": 2.98, "bull": 2.82, "bear": 3.14, "confidence": "medium", "drivers": ["..."], "driver_signals": [] },
    "ltl":    { "base": 97.2, "bull": 95.8, "bear": 99.6, "confidence": "medium", "drivers": ["..."], "driver_signals": [] },
    "imdl":   { "base": 2.28, "bull": 2.12, "bear": 2.38, "confidence": "medium", "drivers": ["..."], "driver_signals": [] },
    "ocean":  { "base": 3420, "bull": 3180, "bear": 3820, "confidence": "medium", "drivers": ["..."], "driver_signals": [] },
    "air":    { "base": 5.08, "bull": 4.82, "bear": 5.42, "confidence": "low", "drivers": ["..."], "driver_signals": [] },
    "rail":   { "base": 1.94, "bull": 1.90, "bear": 1.98, "confidence": "high", "drivers": ["..."], "driver_signals": [] },
    "parcel": { "base": 8.88, "bull": 8.72, "bear": 9.08, "confidence": "high", "drivers": ["..."], "driver_signals": [] }
  },
  "disruptions": ["brief description of each active disruption"],
  "intel_summary": "2-3 sentence CPG Foods-specific market intelligence summary",
  "fetched_at": "ISO datetime"
}`;

const GEMINI_MODEL = 'gemini-2.5-flash';

// Isolate the JSON object from model text and remove trailing commas.
function extractJson(text) {
  let s = (text || '').replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return s.replace(/,(\s*[}\]])/g, '$1'); // strip trailing commas
}

// Parse the model output; if it's malformed, run a strict-JSON repair pass
// through Gemini (no tools, so responseMimeType JSON is allowed).
async function parseOrRepair(rawText) {
  try {
    return JSON.parse(extractJson(rawText));
  } catch (e) {
    const repairUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const res = await fetch(repairUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Return ONLY this content as strict, valid, minified JSON. Fix any syntax errors (missing commas, unescaped quotes, trailing commas). Do not add or remove fields.\n\n' + rawText.slice(0, 24000) }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    if (!res.ok) throw new Error(`Gemini repair ${res.status}`);
    const payload = await res.json();
    const cand = payload.candidates && payload.candidates[0];
    const txt = cand && cand.content && Array.isArray(cand.content.parts)
      ? cand.content.parts.map((p) => p.text || '').join('') : '';
    return JSON.parse(extractJson(txt));
  }
}

// Shared by api/cron.js so the daily job reuses the exact same logic.
export async function runRefresh() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: LIVE_PROMPT }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 0.3,
        // Skip extended "thinking" to keep the daily job well under the 60s limit
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 300)}`);
  }

  const payload = await res.json();

  // Gemini returns candidates[].content.parts[].text
  let rawText = '';
  const cand = payload.candidates && payload.candidates[0];
  if (cand && cand.content && Array.isArray(cand.content.parts)) {
    rawText = cand.content.parts.map((p) => p.text || '').join('');
  }

  const data = await parseOrRepair(rawText);
  data.fetched_at = data.fetched_at || new Date().toISOString();

  // Archive the previous snapshot for day-over-day deltas, then store latest.
  const prev = await kv.get('cpg:latest');
  if (prev) await kv.set('cpg:previous', prev);
  await kv.set('cpg:latest', data);

  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (token !== process.env.REFRESH_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const data = await runRefresh();
    return res.status(200).json({ status: 'ok', data });
  } catch (err) {
    console.error('api/refresh error:', err);
    return res.status(500).json({ status: 'error', message: String(err.message || err) });
  }
}
