// Vercel cron job — runs daily at 17:00 UTC (noon EST / 1pm EDT).
// Vercel sends Authorization: Bearer ${CRON_SECRET} automatically.
import { runRefresh } from './refresh.js';

// Node serverless runtime with extended duration (the grounded refresh is slow).
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  // CRON_SECRET is auto-injected by Vercel for cron invocations. If unset
  // (e.g. local testing), fall back to REFRESH_SECRET.
  const expected = process.env.CRON_SECRET || process.env.REFRESH_SECRET;
  if (expected && auth !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await runRefresh();
    console.log(`[cron] refresh complete at ${new Date().toISOString()}`);
    return res.status(200).json({ status: 'cron_complete' });
  } catch (err) {
    console.error('[cron] refresh failed:', err);
    return res.status(500).json({ status: 'error', message: String(err.message || err) });
  }
}
