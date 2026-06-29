import { kv } from '@vercel/kv';

export const config = { runtime: 'edge' };

const LIVE_PROMPT = `Search the web for TODAY's current US freight market data (use live sources like DAT Freight, FreightWaves, EIA, Drewry). Find:
1. DAT Freight trendlines — national average reefer TL spot rate ($/mile)
2. DAT Freight trendlines — national average dry van TL spot rate ($/mile)
3. EIA.gov latest weekly US national average diesel price ($/gallon)
4. Drewry World Container Index — Shanghai to Los Angeles rate ($/FEU)
5. FreightWaves SONAR or DAT — current reefer load-to-truck ratio (national)
6. FreightWaves SONAR — current tender rejection rate (%)
7. Cass Transportation Index or FreightWaves — LTL rate index ($/cwt) if available
8. Any major disruptions in the past 48 hours affecting US freight (weather, port closures, strikes)

Write a 2–3 sentence transportation market intelligence summary for the Hormel Foods supply chain team. Focus on: current reefer and dry van rate direction, any active disruptions (hurricane, port congestion, Panama Canal), and the single most important procurement action to take today.

Return ONLY valid JSON with no markdown fences:
{
  "reefer": { "rate": 3.47, "chg_pct": 8.2, "src": "DAT", "asof": "YYYY-MM-DD" },
  "dryvan": { "rate": 2.84, "chg_pct": 5.4, "src": "DAT", "asof": "YYYY-MM-DD" },
  "diesel": { "price": 3.89, "src": "EIA", "asof": "YYYY-MM-DD" },
  "ocean_sh_la": { "rate": 3240, "chg_pct": -8.3, "src": "Drewry WCI", "asof": "YYYY-MM-DD" },
  "ltr_reefer": { "ratio": 8.2, "src": "DAT/FreightWaves", "asof": "YYYY-MM-DD" },
  "tender_rej": { "pct": 18.4, "src": "FreightWaves", "asof": "YYYY-MM-DD" },
  "ltl": { "rate": 98.4, "src": "Cass Index", "asof": "YYYY-MM-DD" },
  "disruptions": ["brief description of any active disruption"],
  "intel_summary": "2–3 sentence Hormel-specific market intelligence summary",
  "fetched_at": "ISO datetime"
}`;

// Shared by api/cron.js so the daily job reuses the exact same logic.
export async function runRefresh() {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      tools: [{ type: 'web_search_preview' }],
      input: LIVE_PROMPT,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 300)}`);
  }

  const payload = await res.json();

  // The Responses API returns an `output` array; pull the assistant text out.
  let rawText = '';
  if (typeof payload.output_text === 'string') {
    rawText = payload.output_text;
  } else if (Array.isArray(payload.output)) {
    rawText = payload.output
      .filter((b) => b.type === 'message')
      .flatMap((b) => b.content || [])
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text)
      .join('');
  }

  // Strip any accidental markdown fences, then isolate the JSON object.
  let jsonStr = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const match = jsonStr.match(/\{[\s\S]*\}/);
  if (match) jsonStr = match[0];

  const data = JSON.parse(jsonStr);
  data.fetched_at = data.fetched_at || new Date().toISOString();

  // Archive the previous snapshot for day-over-day deltas, then store latest.
  const prev = await kv.get('hormel:latest');
  if (prev) await kv.set('hormel:previous', prev);
  await kv.set('hormel:latest', data);

  return data;
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (token !== process.env.REFRESH_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const data = await runRefresh();
    return new Response(JSON.stringify({ status: 'ok', data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('api/refresh error:', err);
    return new Response(JSON.stringify({ status: 'error', message: String(err.message || err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
