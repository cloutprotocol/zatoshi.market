'use client';

import { useMemo, useState } from 'react';
import { BadgePill } from '@/components/BadgePill';
import type { UserBadge, UserPointsSummary } from '@/contexts/WalletContext';
import type { UserProfileDoc } from '@/types/profile';

type Props = {
  profile: UserProfileDoc | null;
  address: string;
  badges: UserBadge[];
  points: UserPointsSummary | null;
  isOwner: boolean;
  onEdit: () => void;
  followersCount: number;
  showFollowAction?: boolean;
  isFollowing?: boolean;
  onToggleFollow?: () => void;
  followLoading?: boolean;
  isPrivate?: boolean;
  onTogglePrivacy?: () => void;
  privacyChanging?: boolean;
  pfpUrl?: string;
};

const shortenAddress = (value: string) => `${value.slice(0, 6)}...${value.slice(-4)}`;

const socialIcon = (type: 'twitter' | 'discord' | 'website') => {
  switch (type) {
    case 'twitter':
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.633 7.997c.013.18.013.359.013.54 0 5.504-4.19 11.847-11.847 11.847A11.78 11.78 0 0 1 2 18.94c.272.032.53.045.816.045a8.354 8.354 0 0 0 5.177-1.783 4.173 4.173 0 0 1-3.895-2.895c.257.039.514.065.784.065.37 0 .74-.051 1.084-.142a4.165 4.165 0 0 1-3.34-4.087v-.052c.557.31 1.196.497 1.878.52A4.163 4.163 0 0 1 4.14 6.1a11.83 11.83 0 0 0 8.586 4.353 4.706 4.706 0 0 1-.102-.954 4.162 4.162 0 0 1 7.205-2.846 8.22 8.22 0 0 0 2.64-1.008 4.16 4.16 0 0 1-1.83 2.3 8.312 8.312 0 0 0 2.394-.648 8.862 8.862 0 0 1-2.4 2.2Z" />
        </svg>
      );
    case 'discord':
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.317 4.369A17.643 17.643 0 0 0 16.049 3c-.2.348-.437.816-.6 1.178a16.135 16.135 0 0 0-6.898 0c-.164-.362-.4-.83-.6-1.178a17.668 17.668 0 0 0-4.27 1.37C1.984 9.175 1.19 13.873 1.458 18.51a17.77 17.77 0 0 0 5.438 2.777c.438-.6.831-1.236 1.17-1.893a11.59 11.59 0 0 1-1.844-.879c.156-.114.309-.232.455-.352a12.6 12.6 0 0 0 11.645 0c.148.12.3.238.455.352a11.73 11.73 0 0 1-1.85.88c.34.657.732 1.293 1.17 1.893a17.7 17.7 0 0 0 5.445-2.78c.31-5.002-.52-9.674-2.876-14.142ZM8.917 15.724c-1.137 0-2.062-1.043-2.062-2.326 0-1.284.912-2.327 2.062-2.327 1.15 0 2.068 1.043 2.062 2.327 0 1.283-.912 2.326-2.062 2.326Zm6.18 0c-1.137 0-2.062-1.043-2.062-2.326 0-1.284.912-2.327 2.062-2.327 1.15 0 2.062 1.043 2.062 2.327 0 1.283-.906 2.326-2.062 2.326Z" />
        </svg>
      );
    default:
      return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3C7.032 3 3 7.03 3 12s4.032 9 9 9 9-4.03 9-9-4.032-9-9-9Zm0 2c1.29 0 2.492.366 3.523.994l-3.523 5.643L8.477 5.994A6.972 6.972 0 0 1 12 5Zm-7 7c0-1.29.366-2.492.994-3.523l4.307 6.89V19a7.01 7.01 0 0 1-5.3-7Zm7 7v-3.633l4.307-6.89A7.006 7.006 0 0 1 19 12a7.01 7.01 0 0 1-5.3 7Z" />
        </svg>
      );
  }
};

const buildSocialHref = (type: 'twitter' | 'discord' | 'website', raw: string) => {
  if (/^https?:\/\//i.test(raw)) return raw;
  const value = raw.replace(/^@/, '');
  if (type === 'twitter') return `https://twitter.com/${value}`;
  if (type === 'discord') return value.startsWith('discord.gg/') ? `https://${value}` : `https://discord.gg/${value}`;
  return `https://${value}`;
};

export function ProfileHeader({
  profile,
  address,
  badges,
  points,
  isOwner,
  onEdit,
  followersCount,
  showFollowAction,
  isFollowing,
  onToggleFollow,
  followLoading,
  isPrivate,
  onTogglePrivacy,
  privacyChanging,
  pfpUrl,
}: Props) {
  const [pfpLoaded, setPfpLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const displayName = profile?.displayName || shortenAddress(address);
  const socialEntries = useMemo(
    () =>
      Object.entries(profile?.socialLinks ?? {})
        .filter(([_, value]) => Boolean(value))
        .map(([key, value]) => ({ key: key as 'twitter' | 'discord' | 'website', value: value as string })),
    [profile?.socialLinks]
  );
  const vipBadge = badges.find((badge) => badge.badgeSlug === 'vip');
  const otherBadges = badges.filter((badge) => badge.badgeSlug !== 'vip');
  const handlePrivacyToggle = () => {
    if (!privacyChanging) {
      onTogglePrivacy?.();
    }
  };

  return (
    <section className="relative overflow-hidden rounded-3xl border border-gold-500/20 bg-gradient-to-br from-gold-500/10 via-black to-black shadow-xl">
      <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top,_rgba(255,215,0,0.3),_transparent_70%)]" />
      <div className="relative flex flex-col gap-6 p-6 lg:flex-row lg:items-center">
        <div className="flex flex-col items-center text-center lg:flex-row lg:text-left lg:gap-6">
          <div className="relative h-24 w-24 overflow-hidden rounded-full border-2 border-gold-400/60 bg-black/40">
            {pfpUrl ? (
              <>
                <img
                  src={pfpUrl}
                  alt={displayName}
                  className={`h-full w-full object-cover transition-opacity duration-300 ${pfpLoaded ? 'opacity-100' : 'opacity-0'}`}
                  onLoad={() => setPfpLoaded(true)}
                  onError={() => setPfpLoaded(true)}
                />
                {!pfpLoaded && <div className="absolute inset-0 animate-pulse rounded-full bg-gold-500/10" />}
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-gold-200/60 text-sm">
                {displayName.slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">{displayName}</h1>
            <p className="text-gold-300/80">{shortenAddress(address)}</p>
            {profile?.bio && <p className="mt-2 text-base leading-relaxed text-gold-50/90">{profile.bio}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gold-200/80">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(address).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
                className="rounded-full border border-gold-500/30 px-3 py-1 font-semibold tracking-wide hover:bg-gold-500/10 transition"
              >
                {copied ? 'COPIED' : shortenAddress(address)}
              </button>
              {points && (
                <span className="rounded-full border border-gold-500/20 bg-gold-500/10 px-3 py-1 text-gold-100">
                  {points.total} pts
                </span>
              )}
              {vipBadge && (
                <span className="flex items-center gap-1 rounded-full border border-amber-300/50 bg-amber-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-200">
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3.5 9.7 9.4H3.5l5 3.6-1.9 5.5 5.4-3.8 5.4 3.8-2-5.5 5-3.6h-6.2Z" />
                  </svg>
                  VIP
                </span>
              )}
              {socialEntries.map(({ key, value }) => (
                <a
                  key={key}
                  href={buildSocialHref(key as 'twitter' | 'discord' | 'website', value)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 rounded-full border border-gold-500/30 px-3 py-1 text-sm text-gold-100 hover:bg-gold-500/10"
                >
                  {socialIcon(key as 'twitter' | 'discord' | 'website')}
                  <span>{value}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
        <div className="flex-1 space-y-4">
          {otherBadges.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {otherBadges.map((badge) => (
                <BadgePill key={`${badge.badgeSlug}-${badge.source || 'default'}`} badge={badge} />
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-start gap-3">
          <div className="flex items-center gap-3">
            <span className="text-xs uppercase tracking-wide text-gold-300/80">
              {followersCount} {followersCount === 1 ? 'Follower' : 'Followers'}
            </span>
            {isOwner ? (
              <button
                onClick={onEdit}
                className="rounded-full border border-gold-400/60 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-gold-100 transition hover:bg-gold-500/10"
              >
                Edit Profile
              </button>
            ) : (
              showFollowAction && (
                <button
                  onClick={onToggleFollow}
                  disabled={followLoading}
                  className="rounded-full border border-gold-400/60 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-gold-100 transition hover:bg-gold-500/10 disabled:opacity-60"
                >
                  {followLoading ? 'Please wait…' : isFollowing ? 'Following' : 'Follow'}
                </button>
              )
            )}
          </div>
          {isOwner && (
            <div className="w-full rounded-full border border-gold-500/30 bg-black/30 px-4 py-2 flex items-center justify-between text-xs uppercase tracking-widest text-gold-300/80">
              <span>Private Profile</span>
              <button
                type="button"
                onClick={handlePrivacyToggle}
                disabled={privacyChanging}
                className={`relative h-6 w-12 rounded-full border border-gold-500/30 transition ${isPrivate ? 'bg-gold-400/80' : 'bg-black/60'
                  }`}
              >
                <span
                  className={`absolute inset-0 flex items-center justify-center text-[10px] font-semibold uppercase tracking-widest transition ${isPrivate ? 'text-black' : 'text-white'
                    }`}
                >
                  {isPrivate ? 'ON' : 'OFF'}
                </span>
                {/* <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-black/90 transition ${
                    isPrivate ? 'translate-x-6' : 'translate-x-0.5'
                  }`}
                /> */}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
