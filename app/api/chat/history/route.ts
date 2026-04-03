import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");
  
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
  
  try {
    const response = await fetch(`${backendUrl}/chat/${sessionId}`, {
      cache: "no-store",
    });
    
    if (!response.ok) {
      return NextResponse.json({ error: "Failed to fetch from backend" }, { status: response.status });
    }
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "Network error fetching history" }, { status: 500 });
  }
}
