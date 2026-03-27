with open("routes/chat.py", "r", encoding="utf-8") as f:
    text = f.read()

db_block = """        # Save messages to db
        if supabase:
            try:
                session_id = request.session_id or "default"
                supabase.table("messages").insert([
                    {"session_id": session_id, "role": "user", "content": question},
                    {"session_id": session_id, "role": "assistant", "content": full_answer}
                ]).execute()
            except Exception as e:
                print(f"Error saving to generic messages table: {e}")"""

# Remove all occurrences of db block
while db_block in text:
    text = text.replace(db_block, "")

# Ensure it's empty lines
while "\n\n\n\n" in text:
    text = text.replace("\n\n\n\n", "\n\n")

# Put it back right after the yield finish
old_stop = 'yield _sse({"type": "finish", "finishReason": "stop"})'
new_stop = old_stop + "\n\n" + db_block

text = text.replace(old_stop, new_stop)

with open("routes/chat.py", "w", encoding="utf-8") as f:
    f.write(text)
