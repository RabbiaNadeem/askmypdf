import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

function normalizeBackendUrl(url: string): string {
  return url.replace(/\/$/, '');
}

function buildBackendCandidates(baseUrl: string): string[] {
  const normalized = normalizeBackendUrl(baseUrl);
  const candidates = new Set<string>([normalized]);

  // Common local-dev fallbacks
  candidates.add(normalized.replace('127.0.0.1', 'localhost'));
  candidates.add(normalized.replace('localhost', '127.0.0.1'));
  candidates.add(normalized.replace('0.0.0.0', '127.0.0.1'));
  candidates.add(normalized.replace('0.0.0.0', 'localhost'));

  return Array.from(candidates).filter(Boolean);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

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
    const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
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
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          response = await uploadToBackend(candidate, file);
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          // transient: retry once after a short delay
          if (attempt === 0) await sleep(200);
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
