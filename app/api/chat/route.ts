import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

function normalizeBackendUrl(url: string): string {
  return url.replace(/\/$/, '');
}

function buildBackendCandidates(baseUrl: string): string[] {
  const normalized = normalizeBackendUrl(baseUrl);
  const candidates = new Set<string>([
    normalized.replace('localhost', '127.0.0.1'),
    normalized,
  ]);

  candidates.add(normalized.replace('0.0.0.0', '127.0.0.1'));

  return Array.from(candidates).filter(Boolean);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

const MAX_CHAT_ATTEMPTS_PER_CANDIDATE = 4;
const INITIAL_CHAT_RETRY_DELAY_MS = 250;
const MAX_MULTI_COLLECTIONS = 5;

type TextPart = { type: 'text'; text: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';

  return parts
    .filter((part): part is TextPart => {
      return (
        isRecord(part) &&
        part.type === 'text' &&
        typeof (part as Record<string, unknown>).text === 'string'
      );
    })
    .map((p) => p.text)
    .join('');
}

function extractQuestion(lastMessage: unknown): string {
  if (!isRecord(lastMessage)) return '';

  const content = lastMessage.content;
  if (typeof content === 'string') return content;

  const text = lastMessage.text;
  if (typeof text === 'string') return text;

  return extractTextFromParts(lastMessage.parts);
}

function isFollowUpQuestion(question: string): boolean {
  const q = (question || '').trim().toLowerCase();
  if (!q) return false;

  const wordCount = q.split(/\s+/).filter(Boolean).length;
  const isShort = q.length <= 40 || wordCount <= 7;
  const hasPronoun = /\b(it|that|this|they|them|those|these|he|she|him|her|there|one)\b/.test(q);

  // Continuations like "and X" often rely on the previous question for meaning.
  const startsWithContinuation = /^(and|also|then|plus|more|more on|what about|how about|tell me about)\b/.test(q);

  return isShort && (hasPronoun || startsWithContinuation);
}

function extractLastUserQuestion(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!isRecord(msg)) continue;
    if (msg.role !== 'user') continue;
    const q = extractQuestion(msg);
    if (q && q.trim()) return q.trim();
  }
  return '';
}

function extractPreviousUserQuestion(messages: unknown[]): string {
  let foundLast = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!isRecord(msg)) continue;
    if (msg.role !== 'user') continue;
    const q = extractQuestion(msg);
    if (!q || !q.trim()) continue;
    if (!foundLast) {
      foundLast = true;
      continue;
    }
    return q.trim();
  }
  return '';
}

function buildEffectiveQuestion(messages: unknown[]): string {
  const current = extractLastUserQuestion(messages);
  const previous = extractPreviousUserQuestion(messages);

  if (current && previous && isFollowUpQuestion(current)) {
    return `${previous}\nFollow-up: ${current}`;
  }

  return current;
}

function parseBackendErrorMessage(errorText: string): string {
  const trimmed = (errorText || '').trim();
  if (!trimmed) return '';

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isRecord(parsed)) {
      const detail = parsed.detail;
      if (typeof detail === 'string' && detail.trim()) return detail.trim();
      const err = parsed.error;
      if (typeof err === 'string' && err.trim()) return err.trim();
      const message = parsed.message;
      if (typeof message === 'string' && message.trim()) return message.trim();
    }
  } catch {
    // ignore
  }

  // fall back to raw text (truncate to keep payload reasonable)
  return trimmed.length > 600 ? `${trimmed.slice(0, 600)}…` : trimmed;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];

    const question = buildEffectiveQuestion(messages);

    const rawCollections: unknown =
      body?.collections ?? body?.collection ?? body?.documentIds ?? body?.documentId;

    const activeCollection = typeof body?.activeCollection === 'string' ? body.activeCollection.trim() : '';

    const collections = (() => {
      const out: string[] = [];
      const push = (value: unknown) => {
        if (typeof value !== 'string') return;
        const v = value.trim();
        if (!v) return;
        if (!out.includes(v)) out.push(v);
      };

      if (Array.isArray(rawCollections)) {
        for (const c of rawCollections) push(c);
      } else {
        push(rawCollections);
      }

      return out.slice(0, MAX_MULTI_COLLECTIONS);
    })();

    if (!question || !question.trim()) {
      return NextResponse.json({ error: 'No question provided' }, { status: 400 });
    }

    if (collections.length === 0) {
      return NextResponse.json(
        { error: 'Missing collection(s) (upload PDF(s) first).' },
        { status: 400 },
      );
    }
    
    // Connect to FastAPI backend
    // In dev, Next.js runs on 3000, FastAPI on 8000
    const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
    const candidates = buildBackendCandidates(backendUrl);

    let response: Response | null = null;
    let lastError: unknown = null;

    for (const candidate of candidates) {
      for (let attempt = 0; attempt < MAX_CHAT_ATTEMPTS_PER_CANDIDATE; attempt++) {
        try {
          response = await fetch(`${candidate}/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              question,
              collection: collections,
              activeCollection: activeCollection || undefined,
            }),
          });
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          const delay = INITIAL_CHAT_RETRY_DELAY_MS * Math.pow(2, attempt);
          await sleep(Math.min(delay, 2000));
        }
      }
      if (response) break;
    }

    if (!response) {
      console.error('Chat proxy failed to reach backend', { candidates, lastError });
      return NextResponse.json(
        {
          error:
            'Failed to connect to backend. Make sure the FastAPI server is running and BACKEND_URL is correct.',
          backendCandidates: candidates,
        },
        { status: 502 },
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      const detail = parseBackendErrorMessage(errorText);
      console.error('Backend error:', response.status, detail || errorText);
      return NextResponse.json(
        {
          error: detail || `Backend error (${response.status}).`,
          backendStatus: response.status,
        },
        { status: response.status },
      );
    }

    // Proxy the JSON SSE stream directly to the client
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Error in chat proxy:', error);
    const message = error instanceof Error ? error.message : 'Unknown error.';
    return NextResponse.json(
      {
        error: `Chat request failed. ${message}`,
      },
      { status: 500 },
    );
  }
}
