import { ImageResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../../convex/_generated/api';

export const runtime = 'edge';

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

export async function GET(_: Request, { params }: { params: { handle: string } }) {
  const handle = decodeURIComponent(params.handle);
  const profile = await fetchProfile(handle);
  const address = profile?.address || (looksLikeAddress(handle) ? handle.toLowerCase() : '');
  const displayName = profile?.displayName || (address ? shortenAddress(address) : handle);
  const subtitle = address ? address : 'zatoshi.market';
  const pfpUrl = profile?.pfpInscriptionId
    ? `${SITE_URL}/api/zcash/inscription-content/${profile.pfpInscriptionId}`
    : null;

  return new ImageResponse(
    (
      <div
        style={{
          height: '630px',
          width: '1200px',
          display: 'flex',
          flexDirection: 'row',
          background: 'linear-gradient(135deg, #0f0b00 0%, #1a1300 100%)',
          color: '#fcecc5',
          fontFamily: 'sans-serif',
          padding: '80px',
          gap: '60px',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            height: '320px',
            width: '320px',
            borderRadius: '160px',
            border: '6px solid rgba(255,215,128,0.4)',
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {pfpUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pfpUrl} width={320} height={320} style={{ objectFit: 'cover' }} alt="Profile" />
          ) : (
            <div style={{ fontSize: '120px', opacity: 0.5 }}>{displayName.slice(0, 1).toUpperCase()}</div>
          )}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ fontSize: '64px', fontWeight: 700 }}>{displayName}</div>
          <div style={{ fontSize: '32px', opacity: 0.8 }}>{subtitle}</div>
          <div
            style={{
              marginTop: 'auto',
              fontSize: '28px',
              textTransform: 'uppercase',
              letterSpacing: '8px',
              color: '#fbcf7d',
            }}
          >
            zatoshi.market
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
