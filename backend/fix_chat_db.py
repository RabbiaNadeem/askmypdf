import os
import re

with open("routes/chat.py", "r", encoding="utf-8") as f:
    text = f.read()

# We need to insert the db saving logic.
# After `async for chunk in get_llm().astream(prompt):`
# we accumulate `full_answer` and then save it.

new_generate_func = """    async def generate():
        url = getattr(settings, "SUPABASE_URL", "") or os.getenv("SUPABASE_URL", "")
        key = getattr(settings, "SUPABASE_ANON_KEY", "") or os.getenv("SUPABASE_ANON_KEY", "")
        supabase = None
        if url and key:
            try:
                supabase = create_client(url, key)
            except Exception:
                pass
                
        # Envelope
        yield _sse({"type": "start"})
        yield _sse({"type": "start-step"})
        yield _sse({"type": "text-start", "id": "text-1"})

        # Citations data part
        yield _sse({"type": "data-citations", "id": "citations-1", "data": citations})

        full_answer = ""
        # Answer text streaming
        async for chunk in get_llm().astream(prompt):
            text_chunk = getattr(chunk, "content", None)
            if not text_chunk:
                continue
            full_answer += text_chunk
            yield _sse({"type": "text-delta", "id": "text-1", "delta": text_chunk})

        yield _sse({"type": "text-end", "id": "text-1"})
        yield _sse({"type": "finish-step"})
        yield _sse({"type": "finish", "finishReason": "stop"})
        
        # Save messages to db
        if supabase:
            try:
                session_id = request.session_id or "default"
                supabase.table("messages").insert([
                    {"session_id": session_id, "role": "user", "content": question},
                    {"session_id": session_id, "role": "assistant", "content": full_answer}
                ]).execute()
            except Exception as e:
                print(f"Error saving to generic messages table: {e}")
"""

text = re.sub(
    r'    async def generate\(\).*?yield _sse\(\{"type": "finish", "finishReason": "stop"\}\)',
    new_generate_func,
    text,
    flags=re.DOTALL
)

with open("routes/chat.py", "w", encoding="utf-8") as f:
    f.write(text)
