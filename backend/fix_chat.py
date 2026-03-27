import os
import re

with open("routes/chat.py", "r", encoding="utf-8") as f:
    text = f.read()

import_supabase = "from supabase import create_client\n"
if "from supabase import" not in text:
    text = text.replace("from pydantic import BaseModel", "from pydantic import BaseModel\nfrom supabase import create_client")

new_normalize = """def _resolve_collections_from_docs(request: ChatRequest) -> list[str]:
    \"\"\"Resolves doc_ids to qdrant collection names via Supabase\"\"\"
    doc_ids = request.doc_ids
    active_doc_id = request.active_doc_id
    
    if not doc_ids:
        return []

    url = getattr(settings, "SUPABASE_URL", "") or os.getenv("SUPABASE_URL", "")
    key = getattr(settings, "SUPABASE_ANON_KEY", "") or os.getenv("SUPABASE_ANON_KEY", "")
    if not url or not key:
        return []
    
    try:
        supabase = create_client(url, key)
        res = supabase.table("documents").select("doc_id", "collection").in_("doc_id", doc_ids).execute()
        rows = res.data or []
    except Exception as e:
        print(f"Error resolving docs: {e}")
        return []
        
    doc_map = {row['doc_id']: row['collection'] for row in rows}
    
    out = []
    active_col = None
    if active_doc_id and doc_map.get(active_doc_id):
        active_col = doc_map[active_doc_id]
        out.append(active_col)
        
    for d in doc_ids:
        c = doc_map.get(d)
        if c and c != active_col and c not in out:
            out.append(c)
            
    max_cols = int(getattr(settings, "MAX_MULTI_COLLECTIONS", 5) or 5)
    return out[:max_cols]
"""

# replace _normalize_collections with _resolve_collections_from_docs
# _normalize_collections goes all the way up to `return out[:max_cols]`
# we will use regex
text = re.sub(
    r'def _normalize_collections\(request: ChatRequest\).*?return out\[:max_cols\]',
    new_normalize.strip(),
    text,
    flags=re.DOTALL
)

# also replace _normalize_collections calls
text = text.replace('collections = _normalize_collections(request)', 'collections = _resolve_collections_from_docs(request)')

with open("routes/chat.py", "w", encoding="utf-8") as f:
    f.write(text)
