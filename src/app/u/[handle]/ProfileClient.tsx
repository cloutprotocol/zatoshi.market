'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@/contexts/WalletContext';
import { getConvexClient } from '@/lib/convexClient';
import { api } from '../../../../convex/_generated/api';
import { collections } from '@/config/collections';
import { buildImageUrls, buildTokenName, fetchCollectionMetadata } from '@/lib/collectionAssets';
import type { MintedTokenSummary, UserProfileDoc } from '@/types/profile';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { ProfileGallery } from '@/components/profile/ProfileGallery';
import { ProfileHeaderSkeleton } from '@/components/profile/ProfileHeaderSkeleton';
import { ProfileGallerySkeleton } from '@/components/profile/ProfileGallerySkeleton';

type EditFormState = {
  displayName: string;
  bio: string;
  twitter: string;
  discord: string;
  website: string;
};

const looksLikeAddress = (value: string) => /^t[13][a-z0-9]{10,}$/i.test(value);

const collectionsList = Object.values(collections);

type ZgodsAllowlistMap = Record<string, number>;
let zgodsAllowlistCache: ZgodsAllowlistMap | null = null;
let zgodsAllowlistPromise: Promise<ZgodsAllowlistMap> | null = null;

async function loadZgodsAllowlist(): Promise<ZgodsAllowlistMap> {
  if (zgodsAllowlistCache) return zgodsAllowlistCache;
  if (!zgodsAllowlistPromise) {
    zgodsAllowlistPromise = fetch('/collections/zgods/claim/whitelist.csv')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load whitelist');
        return res.text();
      })
      .then((text) => {
        const map: ZgodsAllowlistMap = {};
        const lines = text.trim().split('\n');
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i]?.split(',');
          if (!cols || cols.length < 2) continue;
          const addr = cols[0]?.trim().toLowerCase();
          const max = Number(cols[1]);
          if (addr) map[addr] = Number.isFinite(max) ? max : 0;
        }
        zgodsAllowlistCache = map;
        return map;
      })
      .finally(() => {
        zgodsAllowlistPromise = null;
      });
  }
  return zgodsAllowlistPromise!;
}

async function getZgodsAllowance(address: string): Promise<number | null> {
  const map = await loadZgodsAllowlist();
  return map[address.toLowerCase()] ?? null;
}

type ProfileClientProps = {
  handle: string;
};

export function ProfileClient({ handle }: ProfileClientProps) {
  const { wallet, badges, points } = useWallet();
  const [profile, setProfile] = useState<UserProfileDoc | null>(null);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawMinted, setRawMinted] = useState<MintedTokenSummary[]>([]);
  const [minted, setMinted] = useState<MintedTokenSummary[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [formState, setFormState] = useState<EditFormState>({ displayName: '', bio: '', twitter: '', discord: '', website: '' });
  const [zgodsCap, setZgodsCap] = useState<number | null>(null);
  const [followers, setFollowers] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [privateUpdating, setPrivateUpdating] = useState(false);

  const isOwner = useMemo(() => {
    if (!wallet?.address || !resolvedAddress) return false;
    return wallet.address.toLowerCase() === resolvedAddress.toLowerCase();
  }, [wallet?.address, resolvedAddress]);

  const refreshProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const convex = getConvexClient();
      if (!convex) throw new Error('Convex client unavailable');
      const res = await convex.query(api.userProfiles.getProfileByHandle, { handle });
      if (res) {
        setProfile(res as UserProfileDoc);
        setResolvedAddress(res.address);
      } else if (looksLikeAddress(handle)) {
        setProfile(null);
        setResolvedAddress(handle.toLowerCase());
      } else {
        setProfile(null);
        setResolvedAddress(null);
        setError('Profile not found');
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [handle]);

  const refreshMinted = useCallback(async () => {
    if (!resolvedAddress) {
      setRawMinted([]);
      return;
    }
    const convex = getConvexClient();
    if (!convex) return;
    setGalleryLoading(true);
    try {
      const allTokens: MintedTokenSummary[] = [];
      for (const collection of collectionsList) {
        const docs = (await convex.query(api.collectionClaims.listMinted, {
          collectionSlug: collection.slug,
          address: resolvedAddress,
          limit: 200,
        })) as any[];
        const enriched = await Promise.all(
          docs.map(async (doc) => {
            const metadata = await fetchCollectionMetadata(collection, doc.tokenId);
            const imageUrls = buildImageUrls(collection, doc.tokenId, metadata);
            return {
              id: `${collection.slug}-${doc.tokenId}`,
              collectionSlug: collection.slug,
              collectionName: collection.name,
              tokenId: doc.tokenId,
              inscriptionId: doc.inscriptionId,
              imageUrls,
              name: buildTokenName(collection, doc.tokenId, metadata),
              createdAt: doc.createdAt ?? 0,
              ownerAddress: resolvedAddress,
            } as MintedTokenSummary;
          })
        );
        allTokens.push(...enriched);
      }
      setRawMinted(allTokens);
    } catch (err) {
      console.error(err);
    } finally {
      setGalleryLoading(false);
    }
  }, [resolvedAddress]);

  const openEditor = useCallback(() => {
    setFormState({
      displayName: profile?.displayName || '',
      bio: profile?.bio || '',
      twitter: profile?.socialLinks?.twitter || '',
      discord: profile?.socialLinks?.discord || '',
      website: profile?.socialLinks?.website || '',
    });
    setEditOpen(true);
  }, [profile]);

  const persistProfile = useCallback(
    async (payload: Partial<UserProfileDoc>) => {
      if (!resolvedAddress) return;
      const convex = getConvexClient();
      if (!convex) throw new Error('Convex client unavailable');
      const result = await convex.mutation(api.userProfiles.saveProfile, {
        address: resolvedAddress,
        ...payload,
      });
      setProfile(result as UserProfileDoc);
    },
    [resolvedAddress]
  );

  const handleTogglePin = useCallback(
    async (inscriptionId: string) => {
      if (!profile || !resolvedAddress) return;
      if (!isOwner) return;
      setSavingIds((prev) => [...prev, inscriptionId]);
      try {
        const current = profile.pinnedTokenIds || [];
        const updated = current.includes(inscriptionId)
          ? current.filter((id) => id !== inscriptionId)
          : [...current, inscriptionId];
        await persistProfile({ pinnedTokenIds: updated });
      } catch (err) {
        console.error('Pin toggle failed', err);
      } finally {
        setSavingIds((prev) => prev.filter((id) => id !== inscriptionId));
      }
    },
    [isOwner, persistProfile, profile, resolvedAddress]
  );

  const handleSelectPfp = useCallback(
    async (inscriptionId: string) => {
      if (!isOwner) return;
      setSavingIds((prev) => [...prev, inscriptionId]);
      try {
        await persistProfile({ pfpInscriptionId: inscriptionId });
      } catch (err) {
        console.error('PFP selection failed', err);
      } finally {
        setSavingIds((prev) => prev.filter((id) => id !== inscriptionId));
      }
    },
    [isOwner, persistProfile]
  );

  const handleSaveProfile = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!isOwner) return;
      setSavingProfile(true);
      try {
        await persistProfile({
          displayName: formState.displayName || undefined,
          bio: formState.bio || undefined,
          socialLinks: {
            twitter: formState.twitter || undefined,
            discord: formState.discord || undefined,
            website: formState.website || undefined,
          },
        });
        setEditOpen(false);
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Failed to save profile');
        console.error(err);
      } finally {
        setSavingProfile(false);
      }
    },
    [formState, isOwner, persistProfile]
  );

  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  useEffect(() => {
    refreshMinted();
  }, [refreshMinted]);

  useEffect(() => {
    if (!resolvedAddress) {
      setZgodsCap(null);
      return;
    }
    getZgodsAllowance(resolvedAddress)
      .then((cap) => setZgodsCap(cap))
      .catch((err) => {
        console.warn('Failed to load ZGODS allocation', err);
        setZgodsCap(null);
      });
  }, [resolvedAddress]);

  useEffect(() => {
    if (!resolvedAddress) {
      setMinted([]);
      return;
    }
    const sorted = [...rawMinted].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    const dedup = new Map<string, MintedTokenSummary>();
    for (const item of sorted) {
      const key = `${item.collectionSlug}-${item.tokenId}`;
      if (!dedup.has(key)) {
        dedup.set(key, item);
      }
    }
    const deduped = Array.from(dedup.values());
    if (zgodsCap && zgodsCap > 0) {
      const zgodsTokens = deduped.filter((token) => token.collectionSlug === 'zgods');
      const otherTokens = deduped.filter((token) => token.collectionSlug !== 'zgods');
      setMinted([...zgodsTokens.slice(0, zgodsCap), ...otherTokens]);
    } else {
      setMinted(deduped);
    }
  }, [rawMinted, zgodsCap, resolvedAddress]);

  const refreshFollowers = useCallback(async () => {
    if (!resolvedAddress) {
      setFollowers(0);
      setIsFollowing(false);
      return;
    }
    const convex = getConvexClient();
    if (!convex) return;
    try {
      const res = await convex.query(api.userFollowers.getSummary, {
        address: resolvedAddress,
        follower: wallet?.address,
      });
      setFollowers(res?.followers ?? 0);
      setIsFollowing(Boolean(res?.isFollowing));
    } catch (err) {
      console.error('Follow summary failed', err);
    }
  }, [resolvedAddress, wallet?.address]);

  useEffect(() => {
    refreshFollowers();
  }, [refreshFollowers]);

  const toggleFollow = useCallback(async () => {
    if (
      !wallet?.address ||
      !resolvedAddress ||
      wallet.address.toLowerCase() === resolvedAddress.toLowerCase() ||
      followLoading
    )
      return;
    const convex = getConvexClient();
    if (!convex) return;
    setFollowLoading(true);
    try {
      if (isFollowing) {
        await convex.mutation(api.userFollowers.unfollow, { address: resolvedAddress, follower: wallet.address });
      } else {
        await convex.mutation(api.userFollowers.follow, { address: resolvedAddress, follower: wallet.address });
      }
      await refreshFollowers();
    } catch (err) {
      console.error('Follow toggle failed', err);
    } finally {
      setFollowLoading(false);
    }
  }, [followLoading, isFollowing, refreshFollowers, resolvedAddress, wallet?.address]);

  const togglePrivacy = useCallback(async () => {
    if (!profile) return;
    setPrivateUpdating(true);
    try {
      await persistProfile({ isPrivate: !profile.isPrivate });
    } catch (err) {
      console.error('Privacy toggle failed', err);
    } finally {
      setPrivateUpdating(false);
    }
  }, [persistProfile, profile]);

  const pfpUrl = useMemo(() => {
    if (!profile?.pfpInscriptionId) return undefined;
    return minted.find((item) => item.inscriptionId === profile.pfpInscriptionId)?.imageUrls[0];
  }, [minted, profile?.pfpInscriptionId]);

  const pinnedIds = profile?.pinnedTokenIds || [];
  const isPrivateView = Boolean(profile?.isPrivate && !isOwner);

  if (loading) {
    return (
      <div className="space-y-8 py-6">
      <ProfileHeaderSkeleton />
      <ProfileGallerySkeleton />
      </div>
    );
  }

  if (error && !resolvedAddress) {
    return <div className="p-6 text-gold-100/80">{error}</div>;
  }

  const content = (
    <div className="space-y-8 py-6">
      {resolvedAddress && (
        <ProfileHeader
          profile={profile}
          address={resolvedAddress}
          badges={badges}
          points={points}
          isOwner={isOwner}
          onEdit={openEditor}
          followersCount={followers}
          showFollowAction={!isOwner && Boolean(wallet?.address)}
          isFollowing={isFollowing}
          onToggleFollow={toggleFollow}
          followLoading={followLoading}
          isPrivate={profile?.isPrivate}
          onTogglePrivacy={togglePrivacy}
          privacyChanging={privateUpdating}
          pfpUrl={pfpUrl}
        />
      )}

      {galleryLoading && minted.length === 0 ? (
        <ProfileGallerySkeleton />
      ) : (
        <ProfileGallery
          items={minted}
          pinnedIds={pinnedIds}
          isOwner={isOwner}
          onTogglePin={handleTogglePin}
          onSelectPfp={handleSelectPfp}
          savingIds={savingIds}
        />
      )}

      {isOwner && editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <form
            className="w-full max-w-2xl space-y-4 rounded-2xl border border-gold-500/30 bg-black/90 p-6"
            onSubmit={handleSaveProfile}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-gold-100">Edit Profile</h3>
              <button type="button" onClick={() => setEditOpen(false)} className="text-gold-300 hover:text-white">
                Close
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm font-semibold text-gold-200">
                Display Name
                <input
                  value={formState.displayName}
                  onChange={(e) => setFormState((prev) => ({ ...prev, displayName: e.target.value }))}
                  className="w-full rounded-lg border border-gold-500/40 bg-black/40 p-2 text-white"
                  placeholder="Public name"
                />
              </label>
              <label className="space-y-2 text-sm font-semibold text-gold-200 md:col-span-2">
                Bio
                <textarea
                  value={formState.bio}
                  onChange={(e) => setFormState((prev) => ({ ...prev, bio: e.target.value }))}
                  className="w-full rounded-lg border border-gold-500/40 bg-black/40 p-2 text-white"
                  rows={4}
                  placeholder="Share your story"
                />
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {(['twitter', 'discord', 'website'] as const).map((field) => (
                <label key={field} className="space-y-2 text-sm font-semibold text-gold-200">
                  {field.charAt(0).toUpperCase() + field.slice(1)}
                  <input
                    value={formState[field]}
                    onChange={(e) => setFormState((prev) => ({ ...prev, [field]: e.target.value }))}
                    className="w-full rounded-lg border border-gold-500/40 bg-black/40 p-2 text-white"
                    placeholder={field === 'website' ? 'https://…' : '@handle'}
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="rounded-full border border-gold-500/40 px-4 py-2 text-sm font-semibold text-gold-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingProfile}
                className="rounded-full bg-gold-400 px-5 py-2 text-sm font-semibold text-black disabled:opacity-70"
              >
                {savingProfile ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );

  if (isPrivateView) {
    const canFollow = !isOwner && Boolean(wallet?.address);
    return (
      <div className="fixed inset-x-0 top-16 bottom-0 z-40 flex items-center justify-center px-4">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="blur-2xl opacity-30">{content}</div>
        </div>
        <div className="relative w-full max-w-xl rounded-3xl border border-gold-500/30 bg-black/70 backdrop-blur-xl p-10 text-center space-y-6 pointer-events-auto">
          <div className="text-2xl font-semibold text-gold-100">This profile is private</div>
          <p className="text-gold-200/80">
            The owner has enabled private mode. Follow them or check back later once access is granted.
          </p>
          {canFollow && (
            <button
              onClick={toggleFollow}
              disabled={followLoading}
              className="inline-flex items-center justify-center rounded-full border border-gold-400/60 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-gold-100 transition hover:bg-gold-500/10 disabled:opacity-60"
            >
              {followLoading ? 'Please wait…' : isFollowing ? 'Following' : 'Follow'}
            </button>
          )}
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-gold-500/40 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-gold-100 hover:bg-gold-500/10 transition"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return content;
}
