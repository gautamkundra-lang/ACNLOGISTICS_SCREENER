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

PART C — RATE OUTLOOK that INCORPORATES the Part B events. For EACH mode (reefer, dryvan, ltl, imdl, ocean, air, rail, parcel) give a 30-day forecast as base/bull(rates fall, favorable)/bear(rates rise, unfavorable) numbers in that mode's native unit, and list the specific event drivers behind the outlook. Use your knowledge of historical freight-rate seasonality and typical patterns (e.g. produce season reefer tightening, Q4 holiday peak, Lunar New Year ocean slack) TOGETHER with the current events found via search to set realistic bull/base/bear levels — do not just echo the current rate. Each forecast's "drivers" must cite concrete reasons (seasonal pattern AND/OR a specific Part B event).

Then write a 2–3 sentence CPG Foods-specific intelligence summary covering rate direction, the most important active event(s), and the single most important action to take today.

Return ONLY valid JSON, no markdown fences, this exact shape (units: reefer/dryvan/imdl/rail $/mi, ltl $/cwt, ocean/air per FEU or $/kg, parcel $/pkg — match the dashboard):
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
    "reefer": { "base": 3.65, "bull": 3.52, "bear": 3.92, "drivers": ["event-based reason", "..."] },
    "dryvan": { "base": 2.98, "bull": 2.82, "bear": 3.14, "drivers": ["..."] },
    "ltl":    { "base": 97.2, "bull": 95.8, "bear": 99.6, "drivers": ["..."] },
    "imdl":   { "base": 2.28, "bull": 2.12, "bear": 2.38, "drivers": ["..."] },
    "ocean":  { "base": 3420, "bull": 3180, "bear": 3820, "drivers": ["..."] },
    "air":    { "base": 5.08, "bull": 4.82, "bear": 5.42, "drivers": ["..."] },
    "rail":   { "base": 1.94, "bull": 1.90, "bear": 1.98, "drivers": ["..."] },
    "parcel": { "base": 8.88, "bull": 8.72, "bear": 9.08, "drivers": ["..."] }
  },
  "disruptions": ["brief description of each active disruption"],
  "intel_summary": "2-3 sentence CPG Foods-specific market intelligence summary",
  "fetched_at": "ISO datetime"
}`;

const GEMINI_MODEL = 'gemini-2.5-flash';

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

  // Strip any accidental markdown fences, then isolate the JSON object.
  let jsonStr = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const match = jsonStr.match(/\{[\s\S]*\}/);
  if (match) jsonStr = match[0];

  const data = JSON.parse(jsonStr);
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
