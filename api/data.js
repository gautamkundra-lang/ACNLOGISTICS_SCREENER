import { kv } from '@vercel/kv';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const [current, previous] = await Promise.all([
      kv.get('hormel:latest'),
      kv.get('hormel:previous'),
    ]);

    if (!current) {
      return new Response(JSON.stringify({ status: 'no_data' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // Next scheduled refresh: today or tomorrow at 17:00 UTC (noon EST)
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(17, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

    return new Response(
      JSON.stringify({ status: 'ok', current, previous: previous || null, next_refresh_utc: next.toISOString() }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }
    );
  } catch (err) {
    console.error('api/data error:', err);
    return new Response(JSON.stringify({ status: 'error', message: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
