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

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto p-4">
      <header className="py-4 border-b mb-4">
        <h1 className="text-xl font-bold">Ask My PDF</h1>
        {uploadedFilename ? (
          <p className="text-sm text-gray-500 mt-1">Active PDF: {uploadedFilename}</p>
        ) : (
          <p className="text-sm text-gray-500 mt-1">
            Upload a PDF to start.{' '}
            <Link href="/" className="underline">
              Go to upload
            </Link>
          </p>
        )}
      </header>
      
      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 mt-20">
            <p>{chatEnabled ? 'Ask a question to get started.' : 'Upload a PDF first to enable chat.'}</p>
          </div>
        ) : (
          messages.map(m => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div 
                className={`max-w-[80%] rounded-lg p-3 ${
                  m.role === 'user' 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                  <p className="whitespace-pre-wrap text-sm">{getMessageText(m)}</p>
              </div>
            </div>
          ))
        )}
        {isLoading && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex justify-start">
                 <div className="max-w-[80%] rounded-lg p-3 bg-gray-100 text-gray-800">
                    <span className="animate-pulse text-sm">Thinking...</span>
                 </div>
            </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={onSubmit} className="flex gap-2 border-t pt-4 bg-white/50 backdrop-blur-sm sticky bottom-0 pb-4">
        <input
          className="flex-1 p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question..."
          disabled={!chatEnabled || isLoading}
        />
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
          type="submit"
          disabled={!chatEnabled || isLoading || !input.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
}
