// Vercel cron job — runs daily at 17:00 UTC (noon EST / 1pm EDT)
// Vercel injects CRON_SECRET and passes it as Authorization header automatically.

export const config = { maxDuration: 60 };

export default async function handler(req) {
  // Vercel sets this header automatically for cron invocations
  const auth = req.headers.get('authorization') || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Delegate to the refresh endpoint internally (same process, avoids HTTP round-trip)
  const { default: refreshHandler } = await import('./refresh.js');

  // Build a synthetic POST request with the REFRESH_SECRET so refresh.js auth passes
  const syntheticReq = new Request('http://localhost/api/refresh', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${process.env.REFRESH_SECRET}`,
      'content-type': 'application/json',
    },
  });

  const result = await refreshHandler(syntheticReq);
  const body = await result.json();

  console.log(`[cron] Refresh completed at ${new Date().toISOString()}`, body.status);
  return Response.json({ status: 'cron_complete', refresh: body.status });
}
