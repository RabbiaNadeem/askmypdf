'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type UploadStage = 'idle' | 'uploading' | 'ingesting' | 'ready' | 'error';

type UploadSuccess = {
  doc_id?: string;
  filename: string;
  url?: string | null;
  message?: string;
  chunks?: number;
  collection?: string;
};

type DocumentRow = {
  doc_id: string;
  filename: string;
  url?: string | null;
  collection: string;
  chunks?: number | null;
  created_at?: string;
};

function formatPercent(value: number) {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  const [dragActive, setDragActive] = useState(false);
  const [stage, setStage] = useState<UploadStage>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadSuccess | null>(null);

  const [recentDocs, setRecentDocs] = useState<DocumentRow[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);

  const refreshDocuments = useCallback(async () => {
    setDocsLoading(true);
    setDocsError(null);
    try {
      const res = await fetch('/api/documents?limit=20', { cache: 'no-store' });
      const text = await res.text();
      if (!res.ok) {
        try {
          const json = JSON.parse(text) as { error?: string; detail?: string };
          throw new Error(json.detail || json.error || `Failed to load documents (${res.status}).`);
        } catch {
          throw new Error(`Failed to load documents (${res.status}).`);
        }
      }
      const json = JSON.parse(text) as { documents?: DocumentRow[] };
      setRecentDocs(Array.isArray(json.documents) ? json.documents : []);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load documents.';
      // Suppress 502 in UI, but clear stale results so we don't show ghost documents.
      if (message.includes('502')) {
        setRecentDocs([]);
        setDocsError(null);
      } else {
        setDocsError(message);
      }
    } finally {
      setDocsLoading(false);
    }
  }, []);

  const isBusy = stage === 'uploading' || stage === 'ingesting';
  const canChat = stage === 'ready' && !!result?.filename;

  const statusText = useMemo(() => {
    if (stage === 'idle') return 'Drop a PDF here, or click to select.';
    if (stage === 'uploading') return `Uploading… ${formatPercent(progress)}`;
    if (stage === 'ingesting') return 'Ingesting…';
    if (stage === 'ready') return 'Ready!';
    return 'Upload failed.';
  }, [stage, progress]);

  const startUpload = useCallback(async (file: File) => {
    setError(null);
    setResult(null);

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setStage('error');
      setError('Please select a PDF file.');
      return;
    }

    setStage('uploading');
    setProgress(0);

    const form = new FormData();
    form.append('file', file, file.name);

    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');

      xhr.upload.onprogress = (evt) => {
        if (!evt.lengthComputable) return;
        const pct = (evt.loaded / evt.total) * 100;
        setProgress(pct);
      };

      xhr.upload.onload = () => {
        // Upload finished; server may still be ingesting
        setStage('ingesting');
      };

      xhr.onerror = () => {
        setStage('error');
        setError('Network error during upload.');
        resolve();
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const json = JSON.parse(xhr.responseText) as UploadSuccess;
            setResult(json);
            setStage('ready');
            if (json?.filename) {
              localStorage.setItem('askmypdf:lastUploaded', json.filename);
            }
            if (json?.collection) {
              localStorage.setItem('askmypdf:lastDocId', String(json.doc_id));
            }
            void refreshDocuments();
          } catch {
            setStage('error');
            setError('Upload succeeded but response was invalid.');
          }
          resolve();
          return;
        }

        try {
          const errJson = JSON.parse(xhr.responseText) as { detail?: string; error?: string };
          setError(errJson.detail || errJson.error || `Upload failed (${xhr.status}).`);
        } catch {
          setError(`Upload failed (${xhr.status}).`);
        }
        setStage('error');
        resolve();
      };

      xhr.send(form);
    });

  }, [refreshDocuments]);

  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  const handleUseDocument = (doc: DocumentRow) => {
    localStorage.setItem('askmypdf:lastUploaded', doc.filename);
    localStorage.setItem('askmypdf:lastDocId', doc.doc_id);
    localStorage.setItem('askmypdf:lastCollection', doc.collection);
    router.push('/chat');
  };

  const onFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const list = Array.from(files).slice(0, 5);
      void (async () => {
        for (const file of list) {
          // Upload sequentially to keep ingestion predictable.
          // eslint-disable-next-line no-await-in-loop
          await startUpload(file);
        }
      })();
    },
    [startUpload],
  );

  const showPulse = !isBusy && (stage === 'idle' || stage === 'ready');

  return (
    <div className="min-h-screen neu-page flex items-center justify-center px-4">
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 py-10">
        <header className="space-y-1 text-center">
          <h1 className="neu-title text-4xl">Ask My PDF</h1>
          <p className="text-sm font-medium opacity-80">Upload up to 5 PDFs to unlock multi-document chat.</p>
        </header>

        <div
          className={
            "neu-panel-inset p-8 sm:p-10 cursor-pointer " +
            (dragActive ? ' neu-panel-inset-hover' : '') +
            (showPulse ? ' neu-panel-inset-pulse' : '')
          }
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            if (isBusy) return;
            fileInputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (isBusy) return;
            setDragActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragActive(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (isBusy) return;
            setDragActive(false);
            onFiles(e.dataTransfer.files);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (isBusy) return;
              fileInputRef.current?.click();
            }
          }}
        >
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="text-xs font-semibold tracking-[0.25em] uppercase opacity-70">
              Upload PDF
            </div>
            <div className="text-base font-semibold">{statusText}</div>

            {stage === 'uploading' && (
              <div className="w-full max-w-md">
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200/60">
                  <div
                    className="h-2 rounded-full bg-zinc-900"
                    style={{ width: `${Math.max(1, Math.min(100, progress))}%` }}
                  />
                </div>
              </div>
            )}

            {stage === 'ready' && result?.filename && (
              <div className="text-sm opacity-80">
                <span className="neu-pill-raised">
                  <span className="neu-pill-dot" aria-hidden="true" />
                  <span>Active PDF</span>
                  <span className="truncate max-w-[10rem]">{result.filename}</span>
                </span>
              </div>
            )}

            {stage === 'error' && error && (
              <div className="text-sm text-red-600">{error}</div>
            )}

            <div className="mt-4 flex w-full max-w-md flex-col gap-3 sm:flex-row">
              <button
                type="button"
                className="neu-btn neu-btn-primary inline-flex h-10 w-full items-center justify-center sm:w-auto sm:flex-1"
                disabled={isBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                Select PDF
              </button>

              <Link
                href="/chat"
                className={
                  "inline-flex h-10 w-full items-center justify-center text-sm font-medium sm:w-auto sm:flex-1 " +
                  (canChat
                    ? 'neu-btn neu-btn-danger'
                    : 'pointer-events-none neu-btn neu-btn-danger opacity-60')
                }
                aria-disabled={!canChat}
                tabIndex={canChat ? 0 : -1}
                onClick={(e) => e.stopPropagation()}
              >
                Go to chat
              </Link>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={(e) => onFiles(e.target.files)}
              disabled={isBusy}
            />
          </div>
        </div>

        <section className="neu-panel-inset p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold tracking-[0.15em] uppercase opacity-70">
              Recent documents
            </h2>
            <button
              type="button"
              className="neu-chip text-xs"
              onClick={() => void refreshDocuments()}
              disabled={docsLoading}
              aria-disabled={docsLoading}
              title="Refresh list"
            >
              Refresh
            </button>
          </div>

          {docsError && <div className="mt-3 text-sm text-red-600">{docsError}</div>}

          {docsLoading ? (
            <div className="mt-4 text-sm opacity-70">Loading…</div>
          ) : recentDocs.length === 0 ? (
            <div className="mt-4 text-sm opacity-70">No documents yet. Upload one above.</div>
          ) : (
            <div className="mt-4 space-y-2">
              {recentDocs.map((doc) => (
                <div
                  key={doc.doc_id}
                  className="neu-chat-bubble-ai flex items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0 text-left">
                    <div className="truncate text-sm font-semibold">{doc.filename}</div>
                    <div className="text-xs opacity-70">
                      {typeof doc.chunks === 'number' ? `${doc.chunks} chunks` : 'Ready'}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {doc.url ? (
                      <a
                        className="neu-chip text-xs"
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open PDF"
                      >
                        Open
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className="neu-chip text-xs"
                      onClick={() => handleUseDocument(doc)}
                      title="Use this document in chat"
                    >
                      Use
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
