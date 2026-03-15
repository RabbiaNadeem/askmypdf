import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

function normalizeBackendUrl(url: string): string {
  return url.replace(/\/$/, '');
}

function buildBackendCandidates(baseUrl: string): string[] {
  const normalized = normalizeBackendUrl(baseUrl);
  const candidates = new Set<string>([normalized]);

  candidates.add(normalized.replace('127.0.0.1', 'localhost'));
  candidates.add(normalized.replace('localhost', '127.0.0.1'));
  candidates.add(normalized.replace('0.0.0.0', '127.0.0.1'));
  candidates.add(normalized.replace('0.0.0.0', 'localhost'));

  return Array.from(candidates).filter(Boolean);
}

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const lastMessage = messages[messages.length - 1];

    const question = extractQuestion(lastMessage);

    if (!question || !question.trim()) {
      return NextResponse.json({ error: 'No question provided' }, { status: 400 });
    }
    
    // Connect to FastAPI backend
    // In dev, Next.js runs on 3000, FastAPI on 8000
    const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
    const candidates = buildBackendCandidates(backendUrl);

    let response: Response | null = null;
    let lastError: unknown = null;

    for (const candidate of candidates) {
      try {
        response = await fetch(`${candidate}/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            question,
          }),
        });
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!response) {
      console.error('Chat proxy failed to reach backend', { candidates, lastError });
      return NextResponse.json(
        {
          error: 'Failed to connect to backend',
          backendCandidates: candidates,
        },
        { status: 502 },
      );
    }

    if (!response.ok) {
        // Handle backend errors
        const errorText = await response.text();
        console.error('Backend error:', response.status, errorText);
        return NextResponse.json({ error: `Backend error: ${response.status}` }, { status: response.status });
    }

    // Proxy the stream directly to the client
    // Vercel AI SDK can consume this text stream
    return new Response(response.body, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        }
    });

  } catch (error) {
    console.error('Error in chat proxy:', error);
    return NextResponse.json({ error: 'Failed to connect to backend' }, { status: 500 });
  }
}
