# Ask My PDF

Local dev app that lets you upload a PDF, ingest it into a local Chroma vector store, and chat with the document.

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

3. Install frontend deps and run Next.js

```powershell
cd ..
npm install
npm run dev
```

4. Open the app

- Frontend: http://localhost:3000
- Backend health: http://127.0.0.1:8000/

## How it works

- Upload a PDF on the homepage. The file is POSTed to `/api/upload` (Next.js proxy), which forwards to the FastAPI `/upload` endpoint.
- The backend ingests the PDF into a local Chroma DB under `backend/chroma_db/`.
- Visit `/chat` to ask questions. The frontend proxies chat requests to `/api/chat`, which forwards to FastAPI `/chat` and streams token updates back to the UI.

## Environment variables

- `GROQ_API_KEY` (or whichever model provider key you use) — set in your environment or CI/CD secrets. Do NOT commit API keys to git.
- `BACKEND_URL` (optional) — used by the Next.js proxy when the backend is not at the default `http://127.0.0.1:8000`.

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
- **Body**: `application/json` with key `question`

Example using curl:

```bash
curl -X POST -H "Content-Type: application/json" -d '{"question":"What does the document say about embeddings?"}' http://localhost:8000/chat
```

## Notes & troubleshooting

- Don't commit large files (vector DB, uploads). These folders are in `.gitignore`.
- If chat/upload fails with connection errors, verify the backend is running and that `BACKEND_URL` (if set) is correct.
- To restrict chat to a single uploaded PDF, the backend can be updated to accept an optional `filename` and filter retrieval results by that filename.

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
