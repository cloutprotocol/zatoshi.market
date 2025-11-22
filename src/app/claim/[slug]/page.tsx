import { notFound } from 'next/navigation';
import type { Metadata, Viewport } from 'next';
import { ClaimClient } from './ClaimClient';
import { getCollectionConfig } from '@/config/collections';

export const runtime = 'edge';

type Props = {
  params: { slug: string };
};

export function generateViewport() {
  return {
    width: 'device-width',
    initialScale: 1,
    themeColor: '#0b0b0b',
  } satisfies Viewport;
}

export function generateMetadata({ params }: Props): Metadata {
  const collection = getCollectionConfig(params.slug);
  if (!collection) {
    return {
      title: 'Claim - Not found',
      description: 'Collection not found',
    };
  }
  return {
    title: `${collection.name} Claim`,
    description: 'Claim your ZGODS allocation and mint inscription IDs.',
    openGraph: {
      title: `${collection.name} Claim`,
      description: 'Claim your ZGODS allocation and mint inscription IDs.',
      url: `https://zatoshi.market/claim/${collection.slug}`,
      type: 'website',
      images: [
        {
          url: 'https://zatoshi.market/social-og.png',
          width: 1200,
          height: 630,
          alt: 'Zatoshi',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${collection.name} Claim`,
      description: 'Claim your ZGODS allocation and mint inscription IDs.',
      images: ['https://zatoshi.market/social-og.png'],
    },
    themeColor: collection.themeColor || '#0b0b0b',
  };
}

export default function ClaimPage({ params }: Props) {
  const collection = getCollectionConfig(params.slug);
  if (!collection) return notFound();
  return <ClaimClient collection={collection} />;
}
