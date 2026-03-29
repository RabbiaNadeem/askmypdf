# Ask My PDF

Local dev app that lets you upload up to 5 PDFs, ingest them into Qdrant (vector DB), and chat with multiple documents simultaneously.

This repository contains a Next.js frontend and a FastAPI backend.

## Features

- **Single & Multi-Document Chat**: Ask questions about one PDF or search across 5 PDFs at once.
- **PDF Sidebar**: Clean document list in the chat interface with select/deselect and active document highlighting.
- **Vector Search**: Uses Qdrant for semantic similarity search across documents.
- **RAG Pipeline**: Retrieves relevant chunks, deduplicates by page, and scores by confidence.
- **Citations**: Every answer shows which PDF page it came from with a confidence score.
- **Dark/Light Theme**: Theme toggle with CSS variables for both light and dark modes.
- **Neumorphic UI**: Soft, modern design with depth and tactile feedback.

## Quick start (Windows / PowerShell)

Note: run all commands from the folder that contains `package.json` (this repo’s root). If you cloned or unzipped into a parent folder like `...\Ask-my-PDF\askmypdf`, make sure you `cd` into `askmypdf` before running `npm`/`next` commands. Otherwise you may see errors like “Can’t resolve 'tailwindcss'”.

1. Create and activate Python venv

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
```

2. Start the FastAPI backend (default: port 8000)

```powershell
cd backend
uvicorn main:app --reload
```

Alternatively (run from repo root):

```powershell
python -m uvicorn main:app --app-dir backend --reload
```

3. Install frontend deps and run Next.js

```powershell
cd ..
npm --version
npm install
npm run dev
```

If you prefer to run both the backend and frontend at once, open two shells (one for the Python venv/backend and one for Node.js/frontend) and run the commands in each.

4. Open the app

- Frontend: http://localhost:3000
- Backend health: http://127.0.0.1:8000/

## How it works

### Upload Phase
- Upload up to 5 PDFs on the homepage (sequentially or drag-and-drop). Each file is POSTed to `/api/upload`, which forwards to the FastAPI `/upload` endpoint.
- The backend splits each PDF into chunks and ingests them into a separate Qdrant collection (scoped per document).
- Document metadata (filename, collection ID, chunk count) is stored in Supabase Postgres.
- The upload response includes a `collection` ID; the frontend stores it and the document appears in the sidebar.

### Chat Phase
- Visit `/chat` to see all uploaded PDFs in a left sidebar.
- **Select up to 5 PDFs** (checkboxes) to include in your chat session.
- Clicking a PDF makes it the **active document** (highlighted in the header).
- When you ask a question, the frontend sends the list of selected collection IDs to the backend.
- The backend queries **all selected collections** in parallel, merges results, and applies:
  - Score thresholding (default: 0.55 confidence)
  - Keyword matching (to filter irrelevant chunks)
  - Per-page deduplication (keeps best-scoring chunk per page)
- The LLM generates an answer using the merged context and always cites the source PDF + page number.
- Streaming responses appear with bold **citation badges** showing confidence scores (green ≥85%, yellow 70–85%, red <70%).

## Environment variables

- `GROQ_API_KEY` (or whichever model provider key you use) — set in your environment or CI/CD secrets. Do NOT commit API keys to git.
- `BACKEND_URL` (optional) — used by the Next.js proxy when the backend is not at the default `http://127.0.0.1:8000`.
- `MAX_MULTI_COLLECTIONS` (optional, default: 5) — maximum number of PDFs to chat across simultaneously.
- `QDRANT_URL` — your Qdrant endpoint (Qdrant Cloud cluster URL or `http://localhost:6333`).
- `QDRANT_API_KEY` (optional) — required for Qdrant Cloud.
- `SUPABASE_URL` — your Supabase project URL (backend only).
- `SUPABASE_ANON_KEY` — your Supabase anon key (backend only for this project).
- `SUPABASE_BUCKET` (optional) — Supabase Storage bucket name (default: `pdfs`).
- `SUPABASE_PUBLIC_BUCKET` (optional) — set to `true` if bucket is public (default: `true`).
- `RAG_TOP_K` (optional, default: 6) — number of chunks to retrieve per collection before deduplication.
- `RAG_MIN_SCORE` (optional, default: 0.55) — minimum similarity score threshold for retrieval.
- `CONTEXT_MAX_CHUNKS` (optional, default: 6) — maximum chunks to include in LLM context.
- `CITATIONS_MAX` (optional, default: 4) — maximum citation badges to show in UI.

## Supabase setup (Storage + metadata)

This app uploads PDFs into **Supabase Storage** (bucket `pdfs`) and stores document metadata in **Supabase Postgres**.

Important: this project uses the **anon key** server-side. For that to work, you must allow the relevant inserts/selects via RLS policies.

### 1) Create the `documents` table

Run in Supabase SQL editor:

```sql
create table if not exists public.documents (
	doc_id uuid primary key,
	filename text not null,
	storage_path text not null,
	url text,
	collection text not null,
	chunks integer,
	created_at timestamptz not null default now()
);

create index if not exists documents_created_at_idx
	on public.documents (created_at desc);
```

### 2) Enable RLS + allow anon access (dev-friendly)

If you want the backend (using anon key) to insert and read rows, enable RLS and add policies:

```sql
alter table public.documents enable row level security;

drop policy if exists "documents_select_anon" on public.documents;
create policy "documents_select_anon"
on public.documents
for select
to anon
using (true);

drop policy if exists "documents_insert_anon" on public.documents;
create policy "documents_insert_anon"
on public.documents
for insert
to anon
with check (true);
```

### 3) Storage bucket policy (dev-friendly)

Create a bucket named `pdfs` in Supabase Storage.

If the bucket is **public**, PDFs will have a public URL and the UI shows an "Open" link.

To allow the backend (using anon key) to upload into that bucket, add a Storage policy that allows inserts into `storage.objects` for bucket `pdfs`.
The exact SQL can vary by Supabase version, but conceptually you need `insert` for `anon` on `storage.objects` filtered by `bucket_id = 'pdfs'`.

If you prefer safer defaults, switch to a service role key (backend-only) and tighten policies.

## UI features

- Dark / Light theme toggle: a small theme button is pinned to the top-right of the app (client-only). It uses `next-themes` and toggles `.dark` / `.light` class on the document so CSS variables switch cleanly.
- Clear chat: a "Clear chat" action is available in the chat header to reset the conversation.
- Loading/typing indicator and skeletons appear while the AI response is streaming.

## Testing the API directly

### Upload PDF

- **Endpoint**: `POST /upload`
- **Body**: `multipart/form-data` with key `file` (PDF only, max 50MB)

Example using curl:

```bash
curl -X POST -F "file=@your-file.pdf" http://localhost:8000/upload
```

### Chat with Single or Multiple PDFs

- **Endpoint**: `POST /chat`
- **Body**: `application/json` with keys:
	- `question` (string)
	- `collection` (string OR array of strings) — single collection ID or list of up to 5 collection IDs
	- `activeCollection` (optional string) — hint for which document is currently "active" in the UI

#### Single document example:

```bash
curl -X POST -H "Content-Type: application/json" \
	-d '{"question":"What does the document say about embeddings?","collection":"askmypdf_some_doc_abcdef1234"}' \
	http://localhost:8000/chat
```

#### Multiple documents example:

```bash
curl -X POST -H "Content-Type: application/json" \
	-d '{
		"question":"Compare machine learning approaches across all documents",
		"collection":["askmypdf_doc1_abc123","askmypdf_doc2_def456","askmypdf_doc3_ghi789"],
		"activeCollection":"askmypdf_doc1_abc123"
	}' \
	http://localhost:8000/chat
```

The response streams SSE (Server-Sent Events) with:
- `type: "text-delta"` — answer text chunks
- `type: "data-citations"` — citation metadata (filename, page, confidence score, snippet)

Merge results are automatically deduplicated, scored, and context-limited before being sent to the LLM.

## PDF Sidebar & Document Selection

When you visit `/chat`, the left sidebar displays all uploaded PDFs with:

- **Checkbox**: Select/deselect PDFs (up to 5 at once) to include in chat
- **Filename**: Click to make it the active document
- **Metadata**: Shows chunk count and "Active" indicator
- **Open**: Link to view the PDF (if public bucket)
- **Active Indicator**: The currently active PDF has a subtle ring highlight and is shown in the top-right header

### Workflow

1. **Upload Phase**: Upload 1–5 PDFs on the home page
2. **Selection**: Go to `/chat` and check which PDFs to chat across
3. **Active Document**: Click a PDF title (or check it) to set it as active — the header updates and it moves to the top of the selected list
4. **Ask**: Type a question; the backend searches all selected PDFs and returns merged results with citations

If all 5 PDFs are selected and you want to switch to a different one, either:
- Uncheck one and then click a new PDF to select it as active, or
- Just click the PDF you want to focus on (it will replace one if at the limit)

- Don't commit large files (uploads). These folders are in `.gitignore`.
- If chat/upload fails with connection errors, verify the backend is running and that `BACKEND_URL` (if set) is correct.

### Files you likely changed

**Frontend (Multi-Document Features)**
- `app/chat/page.tsx` — chat UI with PDF sidebar, multi-select (up to 5), and active document indicator
- `app/page.tsx` — upload UI supporting multi-file drag-and-drop (sequential upload)
- `app/api/chat/route.ts` — Next.js proxy that accepts `collection` (string or array) and forwards merged collection list to backend
- `app/api/documents/route.ts` — documents list proxy (fetches from backend)
- `app/globals.css` — theme + component styling for sidebar and badges

**Backend (Multi-Collection Retrieval)**
- `backend/routes/chat.py` — `/chat` endpoint now merges results from multiple Qdrant collections, applies scoring/deduping
- `backend/services/retrieval.py` — unchanged (per-collection vector search)
- `backend/routes/upload.py` — unchanged (single-document ingestion to Supabase)

**Recommended commit:**

```bash
git add \
  app/chat/page.tsx \
  app/page.tsx \
  app/api/chat/route.ts \
  app/api/documents/route.ts \
  app/globals.css \
  backend/routes/chat.py \
  README.md

git commit -m "feat: multi-document chat (select up to 5 PDFs, merged retrieval)"
```

## Troubleshooting

- Don't commit large files (uploads). These folders are in `.gitignore`.
- If chat/upload fails with connection errors, verify the backend is running and that `BACKEND_URL` (if set) is correct.
- Multi-document queries: if one collection fails to index or query, the backend skips it and continues with others. Check backend logs for details.

### Multi-Document Specific Issues

- **"Select up to 5 PDFs" error**: You've already selected 5 documents. Uncheck one to select another.
- **Active PDF not updating**: Click the PDF name directly (not just the checkbox) to set it as active, or check it — either action should update the header immediately.
- **Chat not working after upload**: Wait 1–2 seconds for indexing to complete, then refresh the documents list (click "Refresh" button in sidebar).

### General Issues

- If upload fails during ingestion, make sure `QDRANT_URL` points at a running Qdrant (local or Qdrant Cloud) and that `QDRANT_API_KEY` is set if required.
- If chat returns 400 about a missing collection(s), re-upload a PDF first so you have a fresh `collection` id.

## Deploy

To deploy the frontend, Vercel is recommended for Next.js apps. Keep backend secrets in GitHub Actions / Vercel environment variables and do not commit them.

## UI / Design Notes

This project uses a Neumorphic-inspired UI across the upload and chat experiences:

- Soft inset “carved” dropzone for file uploads
- Raised buttons with press/hover depth animation
- Distinct “user” vs. “AI” chat bubbles with clear contrast
- Suggestion chips and skeleton loading states to reduce friction

## Contributing

This is a small demo/work-in-progress. Open an issue or PR with improvements.

### Committing changes

To ensure a clean git history when contributing, make sure you only stage the files you actually modified (for example, `app/globals.css`, `app/page.tsx`, `app/chat/page.tsx`, etc.).

The repository ignores local build artifacts and generated content (e.g., `.next/`, `backend/chroma_db/`, `uploads/`), so your commits should generally only include source code and docs.
