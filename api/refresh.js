import OpenAI from 'openai';
import { kv } from '@vercel/kv';

export const config = { maxDuration: 60 };

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

export default async function handler(req) {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
  }

  // Verify caller identity
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (token !== process.env.REFRESH_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const response = await openai.responses.create({
      model: 'gpt-4o',
      tools: [{ type: 'web_search_preview' }],
      input: LIVE_PROMPT,
    });

    // Extract the text output
    const rawText = response.output
      .filter((b) => b.type === 'message')
      .flatMap((b) => b.content)
      .filter((c) => c.type === 'output_text')
      .map((c) => c.text)
      .join('');

    // Parse JSON — strip any accidental markdown fences
    const jsonStr = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const data = JSON.parse(jsonStr);
    data.fetched_at = data.fetched_at || new Date().toISOString();

    // Archive previous before overwriting
    const prev = await kv.get('hormel:latest');
    if (prev) await kv.set('hormel:previous', prev);

    await kv.set('hormel:latest', data);

    return Response.json({ status: 'ok', data });
  } catch (err) {
    console.error('api/refresh error:', err);
    return Response.json({ status: 'error', message: err.message }, { status: 500 });
  }
}
