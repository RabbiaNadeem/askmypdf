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

  // Common local-dev fallback (prefer IPv4 loopback to avoid ::1 issues)
  candidates.add(normalized.replace('0.0.0.0', '127.0.0.1'));

  return Array.from(candidates).filter(Boolean);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

const MAX_UPLOAD_ATTEMPTS_PER_CANDIDATE = 5;
const INITIAL_RETRY_DELAY_MS = 250;

async function uploadToBackend(backendUrl: string, file: File): Promise<Response> {
  const form = new FormData();
  form.append('file', file, file.name);

  return fetch(`${backendUrl}/upload`, {
    method: 'POST',
    body: form,
  });
}

export async function POST(req: NextRequest) {
  try {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
    const candidates = buildBackendCandidates(backendUrl);

    const incoming = await req.formData();
    const file = incoming.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    const form = new FormData();
    form.append('file', file, file.name);

    let response: Response | null = null;
    let lastError: unknown = null;

    for (const candidate of candidates) {
      for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS_PER_CANDIDATE; attempt++) {
        try {
          response = await uploadToBackend(candidate, file);
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          // transient: retry with a small backoff (backend may be starting/reloading)
          const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
          await sleep(Math.min(delay, 2000));
        }
      }
      if (response) break;
    }

    if (!response) {
      console.error('Upload proxy failed to reach backend', { candidates, lastError });
      return NextResponse.json(
        {
          error: 'Failed to connect to backend',
          backendCandidates: candidates,
        },
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
    console.error('Error in upload proxy:', error);
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
  }
}
