import { kv } from '@vercel/kv';

export const config = { runtime: 'edge' };

// Ingestion endpoint for your TMS / data lake.
//
//   GET  /api/lanes                    → returns the currently stored lane set
//   POST /api/lanes                    → replaces the lane set (token-protected)
//        Authorization: Bearer <REFRESH_SECRET>
//        body: { "lanes": [ { ...lane... }, ... ], "source": "TMS name (optional)" }
//
// Lane schema (only o/d/m/s are required; the rest enrich the table & chart):
//   {
//     "id": 1,                       // optional, auto-assigned if missing
//     "o": "Plant A (MN)",             // origin
//     "d": "Mass Retailer DC Sanger TX",  // destination
//     "m": "Reefer TL",             // mode
//     "note": "CPG Foods / Organic Deli", // commodity / program
//     "s": "$3.82/mi",              // current spot rate (display string)
//     "c30": 9.2,                    // 30-day % change
//     "lt": "8.6",                  // load-to-truck ratio (optional)
//     "otif": "94.2%",              // OTIF actual (optional)
//     "otifTarget": "98.5%",        // OTIF target (optional)
//     "risk": "HIGH",               // HIGH | WATCH | EASING | STABLE (optional)
//     "action": "Lock Now",         // recommended posture (optional)
//     "hist": [3.5, 3.55, ...]      // up to 12-pt rate history for the trend chart (optional)
//   }
//
// A scheduled job in your TMS, or an ETL from your data lake (Snowflake/Databricks/
// BigQuery/S3), posts the top lanes here on whatever cadence you choose.

const MAX_LANES = 200;

export default async function handler(req) {
  if (req.method === 'GET') {
    try {
      const payload = (await kv.get('cpg:lanes')) || null;
      return json({ status: payload ? 'ok' : 'no_data', ...(payload || {}) });
    } catch (err) {
      return json({ status: 'error', message: String(err.message || err) }, 500);
    }
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method Not Allowed' }, 405);
  }

  const auth = req.headers.get('authorization') || '';
  if (auth.replace('Bearer ', '').trim() !== process.env.REFRESH_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const lanes = Array.isArray(body.lanes) ? body.lanes : null;
  if (!lanes) return json({ error: 'Body must contain a "lanes" array' }, 400);
  if (lanes.length > MAX_LANES) return json({ error: `Too many lanes (max ${MAX_LANES})` }, 400);

  // Normalize + validate minimally; assign ids if absent.
  const clean = lanes.map((l, i) => ({
    id: l.id != null ? l.id : i + 1,
    o: String(l.o || '').slice(0, 120),
    d: String(l.d || '').slice(0, 120),
    m: String(l.m || '').slice(0, 60),
    note: String(l.note || '').slice(0, 120),
    s: String(l.s || '').slice(0, 40),
    c30: typeof l.c30 === 'number' ? l.c30 : Number(l.c30) || 0,
    lt: l.lt != null ? String(l.lt).slice(0, 20) : '',
    otif: l.otif != null ? String(l.otif).slice(0, 20) : '',
    otifTarget: l.otifTarget != null ? String(l.otifTarget).slice(0, 20) : '',
    risk: l.risk != null ? String(l.risk).slice(0, 20) : '',
    action: l.action != null ? String(l.action).slice(0, 40) : '',
    hist: Array.isArray(l.hist) ? l.hist.slice(0, 12).map(Number).filter((n) => !isNaN(n)) : [],
  }));

  const record = {
    lanes: clean,
    source: String(body.source || 'TMS').slice(0, 80),
    updated_at: new Date().toISOString(),
  };

  try {
    await kv.set('cpg:lanes', record);
    return json({ status: 'ok', count: clean.length, source: record.source });
  } catch (err) {
    return json({ status: 'error', message: String(err.message || err) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
