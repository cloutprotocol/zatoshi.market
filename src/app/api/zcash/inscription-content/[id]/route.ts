import { NextRequest, NextResponse } from 'next/server';

/**
 * Fetch inscription content from zerdinals indexer
 * Returns the raw content of an inscription
 */

// Cache content for 5 minutes (inscriptions are immutable)
const contentCache = new Map<string, { data: string; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  try {
    // Check cache first
    const cached = contentCache.get(id);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return new NextResponse(cached.data, {
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // Fetch from zerdinals content endpoint
    const response = await fetch(
      `https://indexer.zerdinals.com/content/${id}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch content: ${response.statusText}`);
    }

    const content = await response.text();

    // Update cache
    contentCache.set(id, { data: content, timestamp: Date.now() });

    // Clean old cache entries (keep last 100)
    if (contentCache.size > 100) {
      const firstKey = contentCache.keys().next().value;
      contentCache.delete(firstKey);
    }

    return new NextResponse(content, {
      headers: { 'Content-Type': 'text/plain' }
    });

  } catch (error) {
    console.error('Inscription content error:', error);
    return new NextResponse('Failed to fetch content', { status: 500 });
  }
}
