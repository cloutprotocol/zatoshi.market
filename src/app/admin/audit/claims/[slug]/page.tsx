'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { getConvexClient } from '@/lib/convexClient';
import { api } from '../../../../../../convex/_generated/api';
import { getCollectionConfig } from '@/config/collections';

type ClaimDoc = {
  tokenId: number;
  status: 'reserved' | 'minted' | 'failed';
  address: string;
  inscriptionId?: string;
  lastError?: string;
  createdAt: number;
  updatedAt?: number;
};

type EventDoc = {
  tokenId: number;
  status: string;
  address: string;
  message?: string;
  inscriptionId?: string;
  createdAt: number;
};

type DebugResult = {
  totalClaims: number;
  byStatus: { reserved: number; minted: number; failed: number };
  failedWithErrors: { tokenId: number; error: string }[];
  allClaims: ClaimDoc[];
  totalEvents: number;
  recentEvents: EventDoc[];
};

function parseCsv(text: string): Map<string, { max: number; isVip: boolean }> {
  const map = new Map<string, { max: number; isVip: boolean }>();
  const lines = text.trim().split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]?.split(',').map((c) => c.trim()) || [];
    if (cols.length < 2) continue;
    const address = (cols[0] || '').toLowerCase();
    const max = Number(cols[1]) || 0;
    const isVip = (cols[3] || '').toLowerCase() === 'true';
    if (address) map.set(address, { max, isVip });
  }
  return map;
}

export default function Page() {
  const params = useParams();
  const slug = String(params?.slug || '').toLowerCase();
  const cfg = getCollectionConfig(slug);
  const [data, setData] = useState<DebugResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [whitelist, setWhitelist] = useState<Map<string, { max: number; isVip: boolean }>>(new Map());

  useEffect(() => {
    const load = async () => {
      setError(null);
      try {
        if (cfg?.claimWhitelistPath) {
          const res = await fetch(cfg.claimWhitelistPath);
          if (res.ok) {
            setWhitelist(parseCsv(await res.text()));
          }
        }
      } catch {
        /* ignore */
      }

      try {
        const convex = getConvexClient();
        if (!convex) throw new Error('Convex client unavailable');

        // Try debugClaims first (preferred)
        let result: DebugResult | null = null;
        try {
          result = (await convex.query((api as any).debugClaims.getAllClaims, { collectionSlug: slug })) as any;
        } catch (e) {
          // If not deployed, surface a helpful message
          throw new Error('debugClaims.getAllClaims is not available on this deployment. Use the offline audit script.');
        }
        setData(result);
      } catch (e: any) {
        setError(e.message || String(e));
      }
    };
    load();
  }, [slug, cfg?.claimWhitelistPath]);

  const summary = useMemo(() => {
    if (!data) return null;
    const minted = data.allClaims.filter((c) => c.status === 'minted');
    const reserved = data.allClaims.filter((c) => c.status === 'reserved');
    const failed = data.allClaims.filter((c) => c.status === 'failed');

    const mintedByAddr = new Map<string, number>();
    for (const m of minted) {
      const a = (m.address || '').toLowerCase();
      mintedByAddr.set(a, (mintedByAddr.get(a) || 0) + 1);
    }
    const topMinters = Array.from(mintedByAddr.entries())
      .map(([address, count]) => ({ address, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);

    const overAllocated: { address: string; minted: number; allocation: number; vip: boolean }[] = [];
    const notWhitelisted: { address: string; minted: number }[] = [];
    for (const { address, count } of topMinters) {
      const wl = whitelist.get(address);
      if (!wl) notWhitelisted.push({ address, minted: count });
      else if (count > wl.max) overAllocated.push({ address, minted: count, allocation: wl.max, vip: wl.isVip });
    }

    const topErrors = (() => {
      const m = new Map<string, number>();
      for (const f of failed) {
        const msg = (f.lastError || '').trim();
        if (!msg) continue;
        m.set(msg, (m.get(msg) || 0) + 1);
      }
      return Array.from(m.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    })();

    return {
      mintedCount: minted.length,
      reservedCount: reserved.length,
      failedCount: failed.length,
      topMinters,
      overAllocated,
      notWhitelisted,
      topErrors,
    };
  }, [data, whitelist]);

  return (
    <main className="min-h-screen bg-black text-gold-100 p-6 pt-24">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Claim Audit – {slug.toUpperCase()}</h1>
        {error && (
          <div className="mb-4 p-3 rounded border border-red-600/40 bg-red-950/30 text-red-300 text-sm">
            {error}
            <div className="mt-2 text-red-200/80">
              Offline alternative: export Convex tables and run
              <pre className="mt-1 text-xs">node scripts/audit/audit-from-export.js --slug {slug} --claims temp/collectionClaims.json --events temp/collectionClaimEvents.json --whitelist public/collections/{slug}/claim/whitelist.csv</pre>
            </div>
          </div>
        )}
        {!error && !data && <div>Loading...</div>}
        {summary && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 border border-gold-500/30 rounded-lg bg-black/30">
                <div className="text-sm text-gold-200/60 mb-1">Minted</div>
                <div className="text-2xl font-bold">{summary.mintedCount}</div>
              </div>
              <div className="p-4 border border-gold-500/30 rounded-lg bg-black/30">
                <div className="text-sm text-gold-200/60 mb-1">Reserved</div>
                <div className="text-2xl font-bold">{summary.reservedCount}</div>
              </div>
              <div className="p-4 border border-gold-500/30 rounded-lg bg-black/30">
                <div className="text-sm text-gold-200/60 mb-1">Failed</div>
                <div className="text-2xl font-bold">{summary.failedCount}</div>
              </div>
            </div>
            {!!summary.overAllocated.length && (
              <div className="p-5 border border-red-500/50 rounded-lg bg-red-950/40">
                <div className="text-lg font-bold mb-3 text-red-300">⚠️ Wallet Abusers – Over Allocation</div>
                <div className="space-y-2">
                  {summary.overAllocated.map((o) => (
                    <div key={o.address} className="p-3 bg-black/40 rounded border border-red-500/30">
                      <div className="font-mono text-sm mb-1">{o.address}</div>
                      <div className="text-xs text-red-200">
                        Minted: <span className="font-bold text-red-300">{o.minted}</span> /
                        Allocation: <span className="font-bold">{o.allocation}</span>
                        {o.vip && <span className="ml-2 px-2 py-0.5 bg-gold-500/20 border border-gold-500/40 rounded text-gold-300">VIP</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!!summary.notWhitelisted.length && (
              <div className="p-5 border border-red-600/50 rounded-lg bg-red-950/40">
                <div className="text-lg font-bold mb-3 text-red-300">🚫 Not in Whitelist</div>
                <div className="space-y-2">
                  {summary.notWhitelisted.map((n) => (
                    <div key={n.address} className="p-3 bg-black/40 rounded border border-red-500/30">
                      <div className="font-mono text-sm mb-1">{n.address}</div>
                      <div className="text-xs text-red-200">Minted: <span className="font-bold text-red-300">{n.minted}</span></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!!summary.topMinters.length && (
              <div className="p-5 border border-gold-500/30 rounded-lg bg-black/30">
                <div className="text-lg font-bold mb-3">Top Minters</div>
                <div className="space-y-2">
                  {summary.topMinters.map((m) => {
                    const wl = whitelist.get(m.address);
                    const isAbuser = wl && m.count > wl.max;
                    return (
                      <div key={m.address} className={`p-3 rounded border ${isAbuser ? 'bg-red-950/20 border-red-500/30' : 'bg-black/20 border-gold-500/20'}`}>
                        <div className="flex items-center justify-between">
                          <div className="font-mono text-sm">{m.address}</div>
                          <div className="text-xs">
                            <span className={isAbuser ? 'text-red-300 font-bold' : 'text-gold-200'}>{m.count}</span>
                            {wl && <span className="text-gold-200/60"> / {wl.max}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {!!summary.topErrors.length && (
              <div className="p-5 border border-gold-500/30 rounded-lg bg-black/30">
                <div className="text-lg font-bold mb-3">Top Errors</div>
                <div className="space-y-2">
                  {summary.topErrors.map((e) => (
                    <div key={e.value} className="p-3 bg-black/20 rounded border border-gold-500/20">
                      <div className="text-sm">{e.value}</div>
                      <div className="text-xs text-gold-200/60">Count: {e.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

