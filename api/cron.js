// Vercel cron job — runs daily at 17:00 UTC (noon EST / 1pm EDT).
// Vercel sends Authorization: Bearer ${CRON_SECRET} automatically.
import { runRefresh } from './refresh.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const auth = req.headers.get('authorization') || '';
  // CRON_SECRET is auto-injected by Vercel for cron invocations. If unset
  // (e.g. local testing), fall back to REFRESH_SECRET.
  const expected = process.env.CRON_SECRET || process.env.REFRESH_SECRET;
  if (expected && auth !== `Bearer ${expected}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await runRefresh();
    console.log(`[cron] refresh complete at ${new Date().toISOString()}`);
    return new Response(JSON.stringify({ status: 'cron_complete' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[cron] refresh failed:', err);
    return new Response(JSON.stringify({ status: 'error', message: String(err.message || err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
