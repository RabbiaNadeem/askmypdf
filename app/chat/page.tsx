'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import { DefaultChatTransport } from 'ai';
import { useChat } from '@ai-sdk/react';

type Citation = {
  id: string;
  filename: string;
  page: number;
  score: number;
  snippet: string;
};

type DocumentRow = {
  doc_id: string;
  filename: string;
  url?: string | null;
  collection: string;
  chunks?: number | null;
  created_at?: string;
};

type CitationsPart = {
  type: 'data-citations';
  id?: string;
  data: Citation[];
};

function displayPdfName(rawName: string): string {
  const base = (rawName || '').split(/[/\\]/).pop() || rawName || '';
  let name = base;

  // Ingest uses a temp filename like:
  // askmypdf_<doc_id>_<random>_<original_filename>.pdf
  // Sometimes extra id-like segments appear; strip them defensively.
  if (name.toLowerCase().startsWith('askmypdf_')) {
    name = name.slice('askmypdf_'.length);
  }

  for (let i = 0; i < 3; i++) {
    // uuid-or-hex + token + remainder
    const m1 = name.match(/^([0-9a-f]{8,}(?:-[0-9a-f]{4,}){1,})_([0-9a-z]{6,})_(.+)$/i);
    if (m1) {
      name = m1[3];
      continue;
    }
    const m2 = name.match(/^([0-9a-f]{10,})_([0-9a-z]{6,})_(.+)$/i);
    if (m2) {
      name = m2[3];
      continue;
    }
    break;
  }

  // Final pass: remove a single mkstemp-like random prefix.
  const m3 = name.match(/^([0-9a-z]{6,12})_(.+\.pdf)$/i);
  if (m3) {
    name = m3[2];
  }

  return name || base;
}

function dedupeCitationsByPage(items: Citation[]): Citation[] {
  const best = new Map<string, Citation>();

  for (const c of items) {
    const key = `${c.filename}||${c.page}`;
    const prev = best.get(key);
    if (!prev || c.score > prev.score) {
      best.set(key, { ...c, id: key });
    }
  }

  return Array.from(best.values()).sort((a, b) => b.score - a.score);
}

function isCitationsPart(part: unknown): part is CitationsPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part as { type?: unknown }).type === 'data-citations' &&
    Array.isArray((part as { data?: unknown }).data)
  );
}

function scoreTone(score: number): 'good' | 'mid' | 'bad' {
  // User-facing confidence buckets.
  // green  > 85%
  // yellow 70–85%
  // red    < 70%
  if (score > 0.85) return 'good';
  if (score >= 0.7) return 'mid';
  return 'bad';
}

function formatConfidence(score: number): string {
  const clamped = Math.max(0, Math.min(1, score));
  return `${Math.round(clamped * 100)}%`;
}

export default function ChatPage() {
  const [sessionId] = useState(() => {
    if (typeof window === 'undefined') return crypto.randomUUID();
    let sid = localStorage.getItem('askmypdf:sessionId');
    if (!sid) {
      sid = crypto.randomUUID();
      localStorage.setItem('askmypdf:sessionId', sid);
    }

    return sid;
  });
  const {
    messages,
    sendMessage,
    status,
    setMessages,
    error,
    clearError,
    stop,
  } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });



  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/chat/history?sessionId=${sessionId}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages(data.messages);
        }
      })
      .catch(err => console.error("Failed to load history:", err));
  }, [sessionId, setMessages]);


  const isLoading = status === 'submitted' || status === 'streaming';

  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);

  const [selectionError, setSelectionError] = useState<string | null>(null);

  const [input, setInput] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('askmypdf:lastUploaded');
  });
  const [uploadedCollection, setUploadedCollection] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('askmypdf:lastCollection');
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<DocumentRow | null>(null);

  const [activeCollection, setActiveCollection] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return (
      localStorage.getItem('askmypdf:activeCollection') ||
      localStorage.getItem('askmypdf:lastCollection')
    );
  });

  const [selectedCollections, setSelectedCollections] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];

    const raw = localStorage.getItem('askmypdf:selectedCollections');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed
            .filter((x): x is string => typeof x === 'string')
            .map((x) => x.trim())
            .filter(Boolean)
            .slice(0, 5);
        }
      } catch {
        // ignore
      }
    }

    const fallback = localStorage.getItem('askmypdf:lastCollection');
    return fallback ? [fallback] : [];
  });
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const chatEnabled = selectedCollections.length > 0;

  const activeDoc = useMemo(() => {
    const col = activeCollection || uploadedCollection;
    if (!col) return null;
    return documents.find((d) => d.collection === col) ?? null;
  }, [activeCollection, documents, uploadedCollection]);

  const activeLabel = useMemo(() => {
    if (activeDoc?.filename) return activeDoc.filename;
    if (uploadedFilename) return uploadedFilename;
    return null;
  }, [activeDoc?.filename, uploadedFilename]);

  const [openCitation, setOpenCitation] = useState<
    { messageId: string; citationId: string } | null
  >(null);

  const displayError = submitError ?? error?.message ?? null;

  useEffect(() => {
    if (!pendingDeleteDoc) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingDeleteDoc(null);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingDeleteDoc]);

  const refreshDocuments = useCallback(async () => {
    setDocsLoading(true);
    setDocsError(null);
    try {
      const res = await fetch('/api/documents?limit=50', { cache: 'no-store' });
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
      setDocuments(Array.isArray(json.documents) ? json.documents : []);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load documents.';
      if (message.includes('502')) {
        // Backend unreachable. Don't keep showing stale docs from a previous successful load.
        setDocuments([]);
        setSelectedCollections([]);
        setActiveCollection(null);
        setDocsError(null);
      } else {
        setDocsError(message);
      }
    } finally {
      setDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  useEffect(() => {
    // If collections disappear (deleted / Qdrant reset / Supabase row removed),
    // keep the local selection from pointing at non-existent collections.
    const available = new Set(documents.map((d) => (d.collection || '').trim()).filter(Boolean));

    setSelectedCollections((prev) => prev.filter((c) => available.has((c || '').trim())));

    if (activeCollection && !available.has(activeCollection)) {
      setActiveCollection(null);
    }

    if (uploadedCollection && !available.has(uploadedCollection)) {
      setUploadedCollection(null);
      setUploadedFilename(null);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('askmypdf:lastCollection');
        localStorage.removeItem('askmypdf:lastUploaded');
      }
    }
  }, [documents, activeCollection, uploadedCollection]);

  useEffect(() => {
    // Keep selection sane across reloads.
    if (selectedCollections.length > 0) {
      localStorage.setItem('askmypdf:selectedCollections', JSON.stringify(selectedCollections));
    } else {
      localStorage.removeItem('askmypdf:selectedCollections');
    }
  }, [selectedCollections]);

  useEffect(() => {
    if (activeCollection) {
      localStorage.setItem('askmypdf:activeCollection', activeCollection);
      localStorage.setItem('askmypdf:lastCollection', activeCollection);
      setUploadedCollection(activeCollection);
    }
  }, [activeCollection]);

  useEffect(() => {
    if (activeDoc?.filename) {
      localStorage.setItem('askmypdf:lastUploaded', activeDoc.filename);
      setUploadedFilename(activeDoc.filename);
    }
  }, [activeDoc?.filename]);

  const toggleCollection = (collection: string) => {
    const col = (collection || '').trim();
    if (!col) return;

    setSelectionError(null);
    
    // Check if this collection is currently selected
    const isCurrentlySelected = selectedCollections.includes(col);
    
    if (isCurrentlySelected) {
      // Removing from selection
      setSelectedCollections((prev) => prev.filter((x) => x !== col));
    } else {
      // Adding to selection
      if (selectedCollections.length >= 5) {
        setSelectionError('Select up to 5 PDFs.');
        return;
      }
      setSelectedCollections((prev) => [...prev, col]);
      // Make it active immediately when checked
      setActiveCollection(col);
    }
  };

  const setActiveFromDoc = (doc: DocumentRow) => {
    setActiveCollection(doc.collection);
    setSelectionError(null);
    setSelectedCollections((prev) => {
      const col = doc.collection;
      const alreadySelected = prev.includes(col);
      if (!alreadySelected && prev.length >= 5) {
        setSelectionError('Select up to 5 PDFs. Deselect one to switch.');
        return prev;
      }

      const next = [col, ...prev.filter((x) => x !== col)];
      return next.slice(0, 5);
    });
  };

  const clearErrors = () => {
    setSubmitError(null);
    clearError();
  };

  const handleDeleteDocument = async (doc: DocumentRow) => {
    setDeletingId(doc.doc_id);
    try {
      const res = await fetch(`/api/documents/${doc.doc_id}`, { method: 'DELETE' });
      if (!res.ok) {
        const text = await res.text();
        try {
          const json = JSON.parse(text) as { error?: string; detail?: string };
          throw new Error(json.detail || json.error || 'Failed to delete document');
        } catch {
          throw new Error(text || 'Failed to delete document');
        }
      }
      
      setDocuments((prev) => prev.filter((d) => d.doc_id !== doc.doc_id));

      setSelectedCollections((prev) => prev.filter((c) => c !== doc.collection));
      if (activeCollection === doc.collection) setActiveCollection(null);
      if (uploadedCollection === doc.collection) setUploadedCollection(null);

      // Ensure the list is consistent with the backend after deletion.
      await refreshDocuments();

      setPendingDeleteDoc(null);
      
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : 'Error deleting document');
    } finally {
      setDeletingId(null);
    }
  };

  const openDeleteDialog = (doc: DocumentRow) => {
    setDocsError(null);
    setPendingDeleteDoc(doc);
  };

  const handleClearChat = () => {
    stop();
    setMessages([]);
    setOpenCitation(null);
    clearErrors();
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!chatEnabled || isLoading) return;

    const question = input.trim();
    if (!question) return;

    clearErrors();
    setInput('');
    try {
      await sendMessage(
        { text: question },
        {
          body: {
            collections: selectedCollections,
            activeCollection: activeCollection ?? undefined,
          },
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send message.';
      setSubmitError(message);
    }
  }

  const getMessageText = (message: UIMessage) =>
    message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  const handleSuggestionClick = async (prompt: string) => {
    if (!chatEnabled || isLoading) return;
    clearErrors();
    try {
      await sendMessage(
        { text: prompt },
        {
          body: {
            collections: selectedCollections,
            activeCollection: activeCollection ?? undefined,
          },
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send message.';
      setSubmitError(message);
    }
  };

  const getCitations = (message: UIMessage): Citation[] => {
    const parts = Array.isArray(message.parts) ? message.parts : [];
    const found = parts.find(isCitationsPart);
    return dedupeCitationsByPage(found?.data ?? []);
  };

  return (
    <div className="neu-page flex h-screen flex-col px-4">
      {pendingDeleteDoc ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm delete document"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target && deletingId !== pendingDeleteDoc.doc_id) {
              setPendingDeleteDoc(null);
            }
          }}
        >
          <div className="neu-panel-inset w-full max-w-md p-5">
            <div className="text-sm font-bold">Delete PDF?</div>
            <div className="mt-2 text-sm opacity-80">
              This will permanently delete <span className="font-semibold">{pendingDeleteDoc.filename}</span>.
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="neu-btn"
                onClick={() => setPendingDeleteDoc(null)}
                disabled={deletingId === pendingDeleteDoc.doc_id}
              >
                Cancel
              </button>
              <button
                type="button"
                className="neu-btn neu-btn-danger"
                onClick={() => void handleDeleteDocument(pendingDeleteDoc)}
                disabled={deletingId === pendingDeleteDoc.doc_id}
              >
                {deletingId === pendingDeleteDoc.doc_id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex h-full w-full max-w-5xl flex-col py-4">
        <header className="mb-4">
          <div className="neu-header-bar flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <h1 className="neu-title text-lg font-bold">Ask My PDF</h1>
              <p className="text-xs font-medium opacity-75">
                Ask questions, extract structure, and dig for details.
              </p>
            </div>

            <div className="flex flex-col items-end gap-2">
              {activeLabel ? (
                <div className="flex flex-col items-end gap-1 text-right">
                  <span className="text-[0.65rem] font-semibold tracking-[0.2em] uppercase opacity-60">
                    Active PDF
                  </span>
                  <span className="neu-label-inset max-w-[12rem] truncate" title={activeLabel}>
                    {activeLabel}
                  </span>
                  {selectedCollections.length > 1 && (
                    <span className="text-[0.7rem] font-semibold opacity-70">
                      +{selectedCollections.length - 1} more selected
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-end text-right text-xs opacity-75">
                  <span className="font-medium">Upload a PDF to start.</span>
                  <Link href="/" className="underline">
                    Go to upload
                  </Link>
                </div>
              )}

              <button
                type="button"
                className="neu-chip text-xs"
                onClick={handleClearChat}
                disabled={isLoading || messages.length === 0}
                aria-disabled={isLoading || messages.length === 0}
                title={messages.length === 0 ? 'No messages to clear.' : 'Clear the current chat.'}
              >
                Clear chat
              </button>
            </div>
          </div>
        </header>

        <div className="flex h-full min-h-0 flex-1 flex-col gap-4 md:flex-row">
          <aside className="w-full md:w-[22rem] md:flex-shrink-0">
            <div className="neu-panel-inset h-full p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold tracking-[0.2em] uppercase opacity-70">
                    PDFs
                  </div>
                  <div className="mt-1 text-xs font-medium opacity-75">
                    Select up to 5 to chat across.
                  </div>
                </div>
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
              {selectionError && <div className="mt-2 text-xs text-red-600">{selectionError}</div>}

              <div className="neu-scroll mt-4 max-h-[40vh] space-y-2 overflow-y-auto pr-1 md:max-h-[calc(100vh-12rem)]">
                {docsLoading ? (
                  <div className="text-sm opacity-70">Loading…</div>
                ) : documents.length === 0 ? (
                  <div className="text-sm opacity-70">No documents yet. Upload PDFs first.</div>
                ) : (
                  documents.map((doc) => {
                    const selected = selectedCollections.includes(doc.collection);
                    const isActive = (activeCollection || uploadedCollection) === doc.collection;

                    return (
                      <div
                        key={doc.doc_id}
                        className={
                          'neu-chat-bubble-ai flex items-center justify-between gap-3 p-3 ' +
                          (isActive ? ' ring-2 ring-zinc-900/10 dark:ring-white/10' : '')
                        }
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => setActiveFromDoc(doc)}
                          title="Set active document"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleCollection(doc.collection)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-4 w-4"
                              aria-label={`Select ${doc.filename}`}
                            />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{doc.filename}</div>
                              <div className="text-xs opacity-70">
                                {typeof doc.chunks === 'number' ? `${doc.chunks} chunks` : 'Ready'}
                                {isActive ? ' · Active' : ''}
                              </div>
                            </div>
                          </div>
                        </button>

                        <div className="flex gap-2 shrink-0">
                          {doc.url ? (
                            <a
                              className="neu-chip text-xs flex items-center justify-center"
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
                            className="neu-chip text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                            onClick={() => openDeleteDialog(doc)}
                            disabled={deletingId === doc.doc_id}
                            title="Delete PDF"
                          >
                            {deletingId === doc.doc_id ? '...' : 'Del'}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </aside>

          <section className="flex min-h-0 flex-1 flex-col">
            <div className="neu-scroll mb-4 flex-1 space-y-4 overflow-y-auto pr-1">
        {displayError && (
          <div className="neu-chat-bubble-ai p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm font-semibold">Something went wrong</div>
              <button type="button" className="neu-chip text-xs" onClick={clearErrors}>
                Dismiss
              </button>
            </div>
            <div className="mt-1 text-xs opacity-80 whitespace-pre-wrap">{displayError}</div>
          </div>
        )}
        {messages.length === 0 ? (
          <div className="mt-16 flex flex-col items-center gap-4 text-center">
            <p className="text-sm font-medium opacity-80">
              {chatEnabled
                ? 'Jump in with one of these prompts, or ask your own question.'
                : 'Upload a PDF first to enable chat.'}
            </p>
            {chatEnabled && (
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  className="neu-chip"
                  onClick={() => handleSuggestionClick('Summarize this PDF in 5 bullet points.')}
                >
                  Summarize this PDF
                </button>
                <button
                  type="button"
                  className="neu-chip"
                  onClick={() => handleSuggestionClick('Extract all important dates and events from this PDF.')}
                >
                  Extract key dates
                </button>
                <button
                  type="button"
                  className="neu-chip"
                  onClick={() => handleSuggestionClick('List the main concepts and definitions in this PDF.')}
                >
                  Key concepts & definitions
                </button>
              </div>
            )}
          </div>
        ) : (
          messages.map(m => (
            (() => {
              const citations = m.role === 'assistant' ? getCitations(m) : [];
              const showCitations = citations.length > 0;
              return (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[80%]">
                <div
                  className={`p-3 text-sm whitespace-pre-wrap ${
                    m.role === 'user' ? 'neu-chat-bubble-user' : 'neu-chat-bubble-ai'
                  }`}
                >
                  {getMessageText(m)}
                </div>

                {m.role === 'assistant' && showCitations && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {citations.map((c) => {
                      const tone = scoreTone(c.score);
                      const active =
                        openCitation?.messageId === m.id && openCitation?.citationId === c.id;

                      const displayName = displayPdfName(c.filename);

                      const badgeClasses =
                        tone === 'good'
                          ? 'bg-emerald-600/90 text-white'
                          : tone === 'mid'
                            ? 'bg-amber-500/90 text-white'
                            : 'bg-rose-600/90 text-white';

                      return (
                        <button
                          key={c.id}
                          type="button"
                          className={
                            `rounded-full px-3 py-1 text-xs font-semibold shadow-sm transition-opacity ${badgeClasses} ` +
                            (active ? 'opacity-100' : 'opacity-90 hover:opacity-100')
                          }
                          onClick={() => {
                            setOpenCitation((prev) => {
                              if (prev?.messageId === m.id && prev?.citationId === c.id) return null;
                              return { messageId: m.id, citationId: c.id };
                            });
                          }}
                          title={`${displayName} • p.${c.page} • confidence ${formatConfidence(c.score)}`}
                        >
                          {displayName} · p.{c.page} · {formatConfidence(c.score)}
                        </button>
                      );
                    })}
                  </div>
                )}

                {m.role === 'assistant' && showCitations && openCitation?.messageId === m.id && (
                  (() => {
                    const c = citations.find((x) => x.id === openCitation.citationId);
                    if (!c) return null;
                    const displayName = displayPdfName(c.filename);
                    return (
                      <div className="mt-2 neu-chat-bubble-ai p-3 text-xs">
                        <div className="font-semibold">
                          {displayName} — page {c.page} (confidence {formatConfidence(c.score)})
                        </div>
                        <div className="mt-1 opacity-80">{c.snippet}</div>
                      </div>
                    );
                  })()
                )}
              </div>
            </div>
              );
            })()
          ))
        )}
        {isLoading && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex justify-start">
              <div className="neu-chat-bubble-ai max-w-[80%] p-3">
                <div className="neu-thinking mb-2 text-xs font-semibold opacity-80" aria-live="polite">
                  <span className="neu-thinking-dots" aria-hidden="true">
                    <span>●</span>
                    <span>●</span>
                    <span>●</span>
                  </span>
                  <span className="ml-2">Thinking…</span>
                </div>
                <div className="neu-skeleton-row">
                  <div className="neu-skeleton-block" />
                  <div className="neu-skeleton-block" />
                  <div className="neu-skeleton-block" />
                </div>
              </div>
            </div>
        )}
        <div ref={bottomRef} />
            </div>

        <form onSubmit={onSubmit} className="mt-1">
          <div className="neu-input-well flex items-center gap-3 px-4 py-3">
            <input
              className="neu-input-field flex-1 text-sm font-medium"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (submitError) setSubmitError(null);
                if (error) clearError();
              }}
              placeholder={
                chatEnabled
                  ? selectedCollections.length > 1
                    ? 'Ask a question across your selected PDFs…'
                    : 'Ask a question about your PDF…'
                  : 'Select at least one PDF to start chatting…'
              }
              disabled={!chatEnabled || isLoading}
            />
            <button
              className="neu-send-btn"
              type="submit"
              disabled={!chatEnabled || isLoading || !input.trim()}
              aria-label="Send message"
            >
              <span aria-hidden="true">
                
                ➤
              </span>
            </button>
          </div>
        </form>
          </section>
        </div>
      </div>
    </div>
  );
}
