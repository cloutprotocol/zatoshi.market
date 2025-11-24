import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ConvexHttpClient } from 'convex/browser';
import { ProfileClient } from './ProfileClient';
import { api } from '../../../../convex/_generated/api';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://zatoshi.market';
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

const shortenAddress = (value: string) => `${value.slice(0, 6)}...${value.slice(-4)}`;
const looksLikeAddress = (value: string) => /^t[13][a-z0-9]{10,}$/i.test(value || '');

async function fetchProfile(handle: string) {
  if (!CONVEX_URL) return null;
  const client = new ConvexHttpClient(CONVEX_URL);
  try {
    return await client.query(api.userProfiles.getProfileByHandle, { handle });
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: { handle: string } }): Promise<Metadata> {
  const handle = decodeURIComponent(params.handle);
  const profile = await fetchProfile(handle);
  const address = profile?.address || (looksLikeAddress(handle) ? handle.toLowerCase() : '');
  const displayName = profile?.displayName || (address ? shortenAddress(address) : handle);
  const description = `Check out ${displayName} on zatoshi.market.`;
  const ogImage = `${SITE_URL}/api/og/profile/${encodeURIComponent(handle)}`;

  return {
    title: `${displayName} | zatoshi.market`,
    description,
    openGraph: {
      title: `${displayName} | zatoshi.market`,
      description,
      url: `${SITE_URL}/u/${encodeURIComponent(handle)}`,
      images: [ogImage],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${displayName} | zatoshi.market`,
      description,
      images: [ogImage],
    },
  };
}

export default function ProfilePage({ params }: { params: { handle: string } }) {
  const handle = decodeURIComponent(params.handle);
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-24">
      <Suspense fallback={<div className="text-gold-100/80">Loading profile...</div>}>
        <ProfileClient handle={handle} />
      </Suspense>
    </main>
  );
}
