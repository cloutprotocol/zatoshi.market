import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getCollectionConfig } from '@/config/collections';
import { CollectionClient } from './CollectionClient';

type PageProps = {
  params: { slug: string };
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://zatoshi.market';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const slug = decodeURIComponent(params.slug);
  const collection = getCollectionConfig(slug);
  if (!collection) {
    return {
      title: 'Collection not found | zatoshi.market',
      description: 'Unknown collection',
    };
  }
  return {
    title: `${collection.name} | zatoshi.market`,
    description: `Verified ${collection.name} inscriptions on zatoshi.market.`,
    openGraph: {
      title: `${collection.name} | zatoshi.market`,
      description: `Verified ${collection.name} inscriptions on zatoshi.market.`,
      url: `${SITE_URL}/collection/${collection.slug}`,
    },
  };
}

export default function CollectionPage({ params }: PageProps) {
  const slug = decodeURIComponent(params.slug);
  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 pb-24 pt-24 lg:px-6">
      <Suspense fallback={<div className="text-gold-100/80">Loading collection…</div>}>
        <CollectionClient slug={slug} />
      </Suspense>
    </main>
  );
}
