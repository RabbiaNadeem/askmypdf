import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

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

const MAX_ATTEMPTS_PER_CANDIDATE = 5;
const INITIAL_RETRY_DELAY_MS = 500;

export async function GET(req: NextRequest) {
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
    const candidates = buildBackendCandidates(backendUrl);

    const { searchParams } = new URL(req.url);
    const limit = searchParams.get('limit');

    let response: Response | null = null;
    let lastError: unknown = null;

    for (const candidate of candidates) {
      for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_CANDIDATE; attempt++) {
        try {
          const url = new URL(`${candidate}/documents`);
          if (limit) url.searchParams.set('limit', limit);
          response = await fetch(url.toString(), { method: 'GET' });
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
          await sleep(Math.min(delay, 2000));
        }
      }
      if (response) break;
    }

    if (!response) {
      console.error('Documents proxy failed to reach backend', { candidates, lastError });
      return NextResponse.json(
        { error: 'Failed to connect to backend', backendCandidates: candidates },
        { status: 502 },
      );
    }

    const body = await response.text();

    return new NextResponse(body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Error in documents proxy:', error);
    return NextResponse.json({ error: 'Failed to load documents' }, { status: 500 });
  }
}
