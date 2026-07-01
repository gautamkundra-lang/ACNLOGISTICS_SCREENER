import { kv } from '@vercel/kv';
import { buildSystemPrompt } from './_dashboard-context.js';

export const config = { runtime: 'edge' };

const MODEL = 'gemini-2.5-flash';
const DAILY_LIMIT = 80;        // max copilot messages per IP per day (bounds API cost)
const MAX_HISTORY = 12;        // trailing messages kept for context

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Simple per-IP daily rate limit to bound API spend
  const ip = (req.headers.get('x-forwarded-for') || 'anon').split(',')[0].trim();
  const day = new Date().toISOString().slice(0, 10);
  const rlKey = `chat:rl:${ip}:${day}`;
  try {
    const count = await kv.incr(rlKey);
    if (count === 1) await kv.expire(rlKey, 60 * 60 * 26);
    if (count > DAILY_LIMIT) {
      return new Response(
        JSON.stringify({ error: 'Daily message limit reached. Try again tomorrow.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (e) {
    // If KV is unavailable, fail open rather than blocking chat
    console.error('rate-limit check failed:', e);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const userMessages = Array.isArray(body.messages) ? body.messages.slice(-MAX_HISTORY) : [];
  if (!userMessages.length) {
    return new Response(JSON.stringify({ error: 'No messages provided' }), { status: 400 });
  }

  // Ground the copilot in the latest live data + forecast track record
  let liveData = null;
  let accuracy = null;
  try {
    [liveData, accuracy] = await Promise.all([kv.get('cpg:latest'), kv.get('cpg:accuracy')]);
  } catch (e) {
    console.error('kv.get failed:', e);
  }

  // Gemini takes the system prompt separately and maps roles to user/model.
  const contents = userMessages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content || '').slice(0, 4000) }],
  }));

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`;
  const geminiRes = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildSystemPrompt(liveData, accuracy) }] },
      contents,
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1600,
        // Allow a modest reasoning budget so answers are genuinely analytical
        thinkingConfig: { thinkingBudget: 1024 },
      },
    }),
  });

  if (!geminiRes.ok || !geminiRes.body) {
    const errText = await geminiRes.text().catch(() => '');
    console.error('Gemini error:', geminiRes.status, errText);
    return new Response(JSON.stringify({ error: 'Upstream model error' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Transform Gemini's SSE stream into plain text deltas for the browser
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';

  const stream = new ReadableStream({
    async start(controller) {
      const reader = geminiRes.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const json = JSON.parse(payload);
              const parts = json.candidates?.[0]?.content?.parts || [];
              const text = parts.map((p) => p.text || '').join('');
              if (text) controller.enqueue(encoder.encode(text));
            } catch {
              /* ignore keep-alive / partial frames */
            }
          }
        }
      } catch (e) {
        console.error('stream error:', e);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
