import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
    const { id } = await params;

    const backendReq = await fetch(`${backendUrl}/documents/${id}`, {
      method: 'DELETE',
    });

    if (!backendReq.ok) {
      const errorText = await backendReq.text();
      return NextResponse.json({ error: errorText }, { status: backendReq.status });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Error deleting document:', error);
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 });
  }
}
