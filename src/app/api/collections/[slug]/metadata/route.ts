import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { getCollectionConfig } from '@/config/collections';
import type { CollectionTokenMetadata } from '@/lib/collectionAssets';

const metadataCache: Record<
  string,
  { data: Record<number, CollectionTokenMetadata>; expiresAt: number }
> = {};
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(
  _request: Request,
  { params }: { params: { slug: string } }
) {
  const slug = params.slug?.toLowerCase();
  const collection = getCollectionConfig(slug);
  if (!collection) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
  }

  const now = Date.now();
  const cached = metadataCache[slug];
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.data, {
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      },
    });
  }

  try {
    const dir = path.join(
      process.cwd(),
      'public',
      'collections',
      slug,
      'claim',
      'metadata'
    );
    const files = await fs.readdir(dir);
    const entries: Record<number, CollectionTokenMetadata> = {};

    // Read files in manageable batches to avoid saturating the filesystem
    const batchSize = 200;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const chunk = await Promise.all(
        batch.map(async (file) => {
          if (!file.endsWith('.json')) return null;
          const tokenId = Number(file.replace('.json', ''));
          if (Number.isNaN(tokenId)) return null;
          const content = await fs.readFile(path.join(dir, file), 'utf-8');
          return { tokenId, data: JSON.parse(content) as CollectionTokenMetadata };
        })
      );
      for (const entry of chunk) {
        if (!entry) continue;
        entries[entry.tokenId] = entry.data;
      }
    }

    metadataCache[slug] = {
      data: entries,
      expiresAt: now + CACHE_TTL_MS,
    };

    return NextResponse.json(entries, {
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      },
    });
  } catch (err) {
    console.error(`Failed to load metadata for ${slug}`, err);
    return NextResponse.json(
      { error: 'Unable to load metadata' },
      { status: 500 }
    );
  }
}
