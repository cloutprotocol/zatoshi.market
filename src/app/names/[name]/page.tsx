'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useWallet } from '@/contexts/WalletContext';

const Dither = dynamic(() => import('@/components/Dither'), { ssr: false, loading: () => null });

function shortAddress(addr: string) {
  if (!addr) return '—';
  return addr.length <= 12 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function NameDetailPage({ params }: { params: { name: string } }) {
  const raw = params.name || '';
  const name = useMemo(() => raw.toLowerCase(), [raw]);
  const data = useQuery(api.names.getName, { name });
  const listing = data?.listing || null;
  const owner = data?.name?.owner || '';

  const { wallet, isConnected } = useWallet();
  const cancelListing = useMutation(api.names.cancelNameListing);
  const finalizeSale = useMutation(api.names.finalizeNameSale);

  const mine = isConnected && wallet && wallet.address?.toLowerCase() === owner?.toLowerCase();
  const canBuy = isConnected && wallet && listing && listing.status === 'active' && wallet.address?.toLowerCase() !== owner?.toLowerCase();

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <main className="relative min-h-screen text-gold-100 pt-20">
      <div className="fixed inset-0 w-full h-full opacity-15 -z-10">
        <Dither waveColor={[0.8,0.6,0.2]} disableAnimation={false} enableMouseInteraction={true} mouseRadius={0.3} colorNum={4} waveAmplitude={0.15} waveFrequency={2.2} waveSpeed={0.035}/>
      </div>

      <div className="relative z-10 max-w-[900px] mx-auto px-2 md:px-2 pb-16">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-gold-300/60">Name Detail</p>
            <h1 className="text-3xl font-black text-gold-100 mt-1">{name}.zec</h1>
            <div className="text-sm text-gold-300/70 mt-1">Owner: <span className="font-mono">{shortAddress(owner)}</span></div>
          </div>
          <Link href="/names" className="text-xs uppercase tracking-[0.3em] border border-gold-500/30 px-3 py-1">Back</Link>
        </div>

        {message && (
          <div className="mb-4 text-xs text-gold-300/80">{message}</div>
        )}

        <div className="border border-gold-500/20 bg-black/30 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gold-300/80">
              {listing ? (
                <>Listed at <span className="font-mono text-gold-100">{Number(listing.priceZec).toFixed(4)} ZEC</span></>
              ) : (
                <>No active listing</>
              )}
            </div>
            <div className="flex gap-2">
              {listing && mine && listing.status === 'active' && (
                <button
                  className="px-3 py-1 text-xs font-bold border border-gold-500/30"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await cancelListing({ id: listing._id, sellerAddress: wallet!.address });
                      setMessage('Listing cancelled.');
                    } catch (e: any) { setMessage(e?.message || 'Cancel failed'); }
                    finally { setBusy(false); }
                  }}
                >Cancel</button>
              )}
              {canBuy && (
                <button
                  className="px-3 py-1 text-xs font-bold bg-gold-500 text-black"
                  disabled={busy}
                  onClick={async () => {
                    // Placeholder: in the future, create + exchange PSBT here
                    setBusy(true);
                    setMessage('Preparing purchase (PSBT flow placeholder)…');
                    try {
                      await finalizeSale({ id: listing._id, buyerAddress: wallet!.address });
                      setMessage('Marked as purchased (on-chain transfer pending).');
                    } catch (e: any) { setMessage(e?.message || 'Purchase failed'); }
                    finally { setBusy(false); }
                  }}
                >Buy</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

