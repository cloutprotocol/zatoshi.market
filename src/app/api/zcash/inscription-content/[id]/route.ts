import { NextRequest, NextResponse } from 'next/server';

/**
 * Fetch inscription content from zerdinals indexer
 * Returns the raw content of an inscription
 */

/**
 * Simple retry helper for external API calls
 */
async function fetchWithRetry(url: string, maxRetries = 2): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  throw lastError || new Error('Request failed');
}

// Enterprise-grade cache: 15 minutes (inscription content is immutable and never changes)
// Aggressive caching is safe here since content cannot be modified after inscription
const contentCache = new Map<string, { data: string; timestamp: number }>();
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

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

    // Fetch from zerdinals content endpoint with retry logic
    const response = await fetchWithRetry(
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
