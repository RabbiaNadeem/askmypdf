with open("app/chat/page.tsx", "r", encoding="utf-8") as f:
    text = f.read()

effect_str1 = """
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
"""

# Let's search for just the start and end to accurately find it.
import re

effect_pattern = r"\n\s*useEffect\(\(\) => \{\n\s*if \(\!sessionId\) return;\n\s*fetch\(\`/api/chat/history\?sessionId=\$\{sessionId\}\`\)(.*?)\}, \[sessionId, setMessages\]\);\n"

# extract the match
match = re.search(effect_pattern, text, re.DOTALL)
if match:
    full_effect = match.group(0)
    # remove it from current location
    text = text.replace(full_effect, "")
    
    # insert it after useChat
    use_chat_end = "transport: new DefaultChatTransport({ api: '/api/chat' }),\n  });"
    
    text = text.replace(use_chat_end, use_chat_end + "\n" + full_effect)
    
    with open("app/chat/page.tsx", "w", encoding="utf-8") as f:
        f.write(text)
    print("Fixed!")
else:
    print("Could not find effect")

