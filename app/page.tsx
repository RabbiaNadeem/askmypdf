'use client';

import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';

type UploadStage = 'idle' | 'uploading' | 'ingesting' | 'ready' | 'error';

type UploadSuccess = {
  filename: string;
  message?: string;
  chunks?: number;
};

function formatPercent(value: number) {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [dragActive, setDragActive] = useState(false);
  const [stage, setStage] = useState<UploadStage>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadSuccess | null>(null);

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
  }, []);

  const onFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      void startUpload(files[0]);
    },
    [startUpload],
  );

  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-zinc-900">Ask My PDF</h1>
          <p className="text-sm text-zinc-600">Upload a single PDF to enable chat.</p>
        </header>

        <div
          className={
            "rounded-xl border-2 border-dashed bg-white p-8 transition-colors " +
            (dragActive ? 'border-zinc-900' : 'border-zinc-200')
          }
          onClick={() => {
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
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="text-sm font-medium text-zinc-900">{statusText}</div>

            {stage === 'uploading' && (
              <div className="w-full max-w-md">
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-2 bg-zinc-900"
                    style={{ width: `${Math.max(1, Math.min(100, progress))}%` }}
                  />
                </div>
              </div>
            )}

            {stage === 'ready' && result?.filename && (
              <div className="text-sm text-zinc-700">
                Uploaded: <span className="font-medium">{result.filename}</span>
              </div>
            )}

            {stage === 'error' && error && (
              <div className="text-sm text-red-600">{error}</div>
            )}

            <div className="mt-2 flex w-full max-w-md flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50"
                disabled={isBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                Select PDF
              </button>

              <Link
                href="/chat"
                className={
                  "inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium " +
                  (canChat
                    ? 'border-zinc-200 bg-white text-zinc-900'
                    : 'pointer-events-none border-zinc-200 bg-zinc-100 text-zinc-500')
                }
                aria-disabled={!canChat}
                tabIndex={canChat ? 0 : -1}
              >
                Go to chat
              </Link>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => onFiles(e.target.files)}
              disabled={isBusy}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
