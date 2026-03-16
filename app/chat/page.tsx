'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import { TextStreamChatTransport } from 'ai';
import { useChat } from '@ai-sdk/react';

export default function ChatPage() {
  const { messages, sendMessage, status } = useChat({
    transport: new TextStreamChatTransport({ api: '/api/chat' }),
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  const [input, setInput] = useState('');
  const [uploadedFilename] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('askmypdf:lastUploaded');
  });
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const chatEnabled = !!uploadedFilename;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!chatEnabled || isLoading) return;

    const question = input.trim();
    if (!question) return;

    setInput('');
    await sendMessage({ text: question });
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
    await sendMessage({ text: prompt });
  };

  return (
    <div className="neu-page flex h-screen flex-col px-4">
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col py-4">
        <header className="mb-4">
          <div className="neu-header-bar flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <h1 className="neu-title text-lg font-bold text-zinc-900">Ask My PDF</h1>
              <p className="text-xs font-medium text-gray-600">
                Ask questions, extract structure, and dig for details.
              </p>
            </div>
            {uploadedFilename ? (
              <div className="flex flex-col items-end gap-1 text-right">
                <span className="text-[0.65rem] font-semibold tracking-[0.2em] uppercase text-gray-500">
                  Active PDF
                </span>
                <span className="neu-label-inset max-w-[10rem] truncate" title={uploadedFilename}>
                  {uploadedFilename}
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-end text-right text-xs text-gray-600">
                <span className="font-medium">Upload a PDF to start.</span>
                <Link href="/" className="underline">
                  Go to upload
                </Link>
              </div>
            )}
          </div>
        </header>

        <div className="neu-scroll mb-4 flex-1 space-y-4 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="mt-16 flex flex-col items-center gap-4 text-center">
            <p className="text-sm font-medium text-gray-700">
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
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div 
                className={`max-w-[80%] p-3 text-sm whitespace-pre-wrap ${
                  m.role === 'user' ? 'neu-chat-bubble-user' : 'neu-chat-bubble-ai'
                }`}
              >
                  {getMessageText(m)}
              </div>
            </div>
          ))
        )}
        {isLoading && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex justify-start">
              <div className="neu-chat-bubble-ai max-w-[80%] p-3">
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
              onChange={(e) => setInput(e.target.value)}
              placeholder={chatEnabled ? 'Ask a question about your PDF…' : 'Upload a PDF to start chatting…'}
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
      </div>
    </div>
  );
}
