from fastapi import APIRouter, File, UploadFile, HTTPException
import os

router = APIRouter()


UPLOAD_DIR = "uploads"
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    # Magic byte validation for PDF
    await file.seek(0)
    magic_header = await file.read(4)
    if magic_header != b"%PDF":
        raise HTTPException(status_code=400, detail="Invalid file content. Not a PDF.")
    await file.seek(0)  # Reset cursor

    file.filename = os.path.basename(file.filename)
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    
    # Save the file with size validation
    try:
        size = 0
        with open(file_path, "wb") as buffer:
            while chunk := await file.read(1024 * 1024):  # Read 1MB chunks
                size += len(chunk)
                if size > MAX_FILE_SIZE:
                    buffer.close()
                    os.remove(file_path)
                    raise HTTPException(status_code=413, detail="File too large (max 50MB)")
                buffer.write(chunk)
    except Exception as e:
        if os.path.exists(file_path):
            os.remove(file_path)
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Could not save file: {str(e)}")

    return {"filename": file.filename, "message": "File uploaded successfully"}
