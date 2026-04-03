from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os
from routes.upload import router as upload_router

# Load env vars *before* importing chat routes because they initialize LLM immediately
load_dotenv()

from routes.chat import router as chat_router

app = FastAPI()

origins = [
    "http://localhost:3000",
    "https://askmypdff-olive.vercel.app",
    "https://askmypdf-khaki.vercel.app"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload_router)
app.include_router(chat_router)




@app.get("/")
async def root():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=True)
