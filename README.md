# Ask My PDF

Local dev app that lets you upload a PDF, ingest it into Qdrant (vector DB), and chat with the document.

This repository contains a Next.js frontend and a FastAPI backend.

## Quick start (Windows / PowerShell)

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
npm install
npm run dev
```

If you prefer to run both the backend and frontend at once, open two shells (one for the Python venv/backend and one for Node.js/frontend) and run the commands in each.

4. Open the app

- Frontend: http://localhost:3000
- Backend health: http://127.0.0.1:8000/

## How it works

- Upload a PDF on the homepage. The file is POSTed to `/api/upload` (Next.js proxy), which forwards to the FastAPI `/upload` endpoint.
- The backend splits the PDF into chunks and ingests them into a Qdrant collection that is scoped per document.
- The upload response includes a `collection` id; the frontend stores it and sends it with each chat request.
- Visit `/chat` to ask questions. The frontend proxies chat requests to `/api/chat`, which forwards to FastAPI `/chat` and streams token updates back to the UI (including citation metadata).

## Environment variables

- `GROQ_API_KEY` (or whichever model provider key you use) — set in your environment or CI/CD secrets. Do NOT commit API keys to git.
- `BACKEND_URL` (optional) — used by the Next.js proxy when the backend is not at the default `http://127.0.0.1:8000`.
- `QDRANT_URL` — your Qdrant endpoint (Qdrant Cloud cluster URL or `http://localhost:6333`).
- `QDRANT_API_KEY` (optional) — required for Qdrant Cloud.

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

### Chat with PDF

- **Endpoint**: `POST /chat`
- **Body**: `application/json` with keys:
	- `question` (string)
	- `collection` (string) — returned by `POST /upload`

Example using curl:

```bash
curl -X POST -H "Content-Type: application/json" \
	-d '{"question":"What does the document say about embeddings?","collection":"askmypdf_some_doc_abcdef1234"}' \
	http://localhost:8000/chat
```

## Notes & troubleshooting

- Don't commit large files (uploads). These folders are in `.gitignore`.
- If chat/upload fails with connection errors, verify the backend is running and that `BACKEND_URL` (if set) is correct.

### Files you likely changed

If you followed the recent UI changes, the files you may want to review and commit are:

- `app/globals.css` — theme + component styling
- `app/page.tsx` — upload UI sizing + buttons
- `app/chat/page.tsx` — chat UI, typing indicator, clear/reset
- `app/layout.tsx` — theme provider mount
- `components/mode-toggle.tsx` — theme toggle (new)
- `components/theme-provider.tsx` — theme provider (new)
- `app/api/chat/route.ts` — improved proxy error messages

Stage and commit only the files you intend to add:

```bash
git add app/globals.css app/page.tsx app/chat/page.tsx app/layout.tsx components/mode-toggle.tsx components/theme-provider.tsx app/api/chat/route.ts
git commit -m "UI: add theme toggle, clear/reset, typing indicator and styling fixes"
```
- If upload fails during ingestion, make sure `QDRANT_URL` points at a running Qdrant (local or Qdrant Cloud) and that `QDRANT_API_KEY` is set if required.
- If chat returns 400 about a missing collection, re-upload a PDF first so you have a fresh `collection` id.

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
