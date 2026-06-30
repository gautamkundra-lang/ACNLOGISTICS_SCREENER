// Vercel cron job — runs daily at 17:00 UTC (noon EST / 1pm EDT).
// Vercel sends Authorization: Bearer ${CRON_SECRET} automatically.
import { kv } from '@vercel/kv';
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
    const data = await runRefresh();
    let emailed = false;
    try { emailed = await maybeSendDigest(data); } catch (e) { console.error('digest send failed:', e); }
    console.log(`[cron] refresh complete at ${new Date().toISOString()} (emailed: ${emailed})`);
    return res.status(200).json({ status: 'cron_complete', emailed });
  } catch (err) {
    console.error('[cron] refresh failed:', err);
    return res.status(500).json({ status: 'error', message: String(err.message || err) });
  }
}

// Send a daily briefing email via Resend — only if configured.
async function maybeSendDigest(data) {
  if (!process.env.RESEND_API_KEY || !process.env.ALERT_EMAIL_TO) return false;
  const prev = await kv.get('cpg:previous');
  const html = buildDigestHtml(data, prev);
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.ALERT_EMAIL_FROM || 'CPG Screener <onboarding@resend.dev>',
      to: process.env.ALERT_EMAIL_TO.split(',').map((s) => s.trim()),
      subject: `Freight Daily Briefing — ${new Date().toISOString().slice(0, 10)}`,
      html,
    }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return true;
}

function buildDigestHtml(d, prev) {
  const row = (label, c, p, unit, prefix) => {
    if (c == null) return '';
    let delta = '';
    if (p != null && p) {
      const pct = ((c - p) / p) * 100;
      const up = c > p;
      delta = ` <span style="color:${up ? '#A02010' : '#2E4A20'}">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</span>`;
    }
    return `<tr><td style="padding:4px 10px;color:#4A5548">${label}</td><td style="padding:4px 10px;font-family:monospace;font-weight:700">${prefix || ''}${c}${unit || ''}${delta}</td></tr>`;
  };
  const rates = [
    row('Reefer TL', d.reefer && d.reefer.rate, prev && prev.reefer && prev.reefer.rate, '/mi', '$'),
    row('Dry Van TL', d.dryvan && d.dryvan.rate, prev && prev.dryvan && prev.dryvan.rate, '/mi', '$'),
    row('Diesel', d.diesel && d.diesel.price, prev && prev.diesel && prev.diesel.price, '/gal', '$'),
    row('Ocean SH–LA', d.ocean_sh_la && d.ocean_sh_la.rate, prev && prev.ocean_sh_la && prev.ocean_sh_la.rate, '/FEU', '$'),
    row('Tender rejection', d.tender_rej && d.tender_rej.pct, prev && prev.tender_rej && prev.tender_rej.pct, '%', ''),
  ].join('');
  const events = (d.events || []).slice(0, 5).map((e) =>
    `<li style="margin-bottom:5px"><strong>${esc(e.title)}</strong> <span style="color:#7A8575">(${esc(e.category)} · ${esc(e.direction)})</span><br/><span style="color:#4A5548;font-size:13px">${esc(e.summary || '')}</span></li>`
  ).join('');
  const url = 'https://acn-logistics-screener.vercel.app';
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#1A2816">
    <div style="background:#243220;color:#fff;padding:16px 20px;border-radius:6px 6px 0 0">
      <div style="font-size:16px;font-weight:700;letter-spacing:.04em">CPG FOODS · Freight Daily Briefing</div>
      <div style="font-size:12px;color:rgba(255,255,255,.6)">${new Date().toUTCString()}</div>
    </div>
    <div style="border:1px solid #e0e1d9;border-top:none;padding:18px 20px;border-radius:0 0 6px 6px">
      <p style="font-size:10px;font-weight:700;color:#3B5E28;text-transform:uppercase;letter-spacing:.1em;margin:0 0 6px">Intelligence Summary</p>
      <p style="font-size:14px;line-height:1.6;margin:0 0 16px">${esc(d.intel_summary || 'No summary available.')}</p>
      <p style="font-size:10px;font-weight:700;color:#3B5E28;text-transform:uppercase;letter-spacing:.1em;margin:0 0 6px">Key Rates (vs last refresh)</p>
      <table style="border-collapse:collapse;font-size:13px;margin-bottom:16px">${rates}</table>
      ${events ? `<p style="font-size:10px;font-weight:700;color:#3B5E28;text-transform:uppercase;letter-spacing:.1em;margin:0 0 6px">Top Event Risks</p><ul style="padding-left:18px;margin:0 0 16px">${events}</ul>` : ''}
      <a href="${url}" style="display:inline-block;background:#3B5E28;color:#fff;text-decoration:none;font-size:13px;font-weight:700;padding:9px 18px;border-radius:5px">Open the dashboard →</a>
      <p style="font-size:11px;color:#9AA295;margin:16px 0 0">Automated daily briefing · AI-generated, validate before acting.</p>
    </div>
  </div>`;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
