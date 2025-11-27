'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { ordinalIndexAPI } from '@/services/ordinalIndex';
import { useWallet } from '@/contexts/WalletContext';
import Link from 'next/link';
import { registerZcashName } from '@/services/inscription';

const Dither = dynamic(() => import('@/components/Dither'), { ssr: false, loading: () => null });

const numberFmt = new Intl.NumberFormat('en-US');

function formatZec(n?: number) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '—';
  return `${n.toFixed(4)} ZEC`;
}

export default function NamesPage() {
  const [view, setView] = useState<'recent' | 'index' | 'listings' | 'mine'>('index');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(20);

  // Recent registrations
  const [recentBefore, setRecentBefore] = useState<number | null>(null);
  const recent = useQuery(api.names.listNamesRecent, { limit: 20, before: recentBefore ?? undefined });

  // Full index from indexer (paged) - Split into ZEC and ZCASH
  const [zecPage, setZecPage] = useState(0);
  const [zecItems, setZecItems] = useState<any[]>([]);
  const [zecHasMore, setZecHasMore] = useState(true);
  const [zecLoading, setZecLoading] = useState(false);

  const [zcashPage, setZcashPage] = useState(0);
  const [zcashItems, setZcashItems] = useState<any[]>([]);
  const [zcashHasMore, setZcashHasMore] = useState(true);
  const [zcashLoading, setZcashLoading] = useState(false);

  // Search (when q provided)
  const namesResp = useQuery(api.names.listNames, { q, page, limit });
  const listings = useQuery(api.names.listNameListings, { q: view === 'recent' ? '' : q, limit: 200 });
  // Mine
  const { wallet, isConnected } = useWallet();
  const [mineBefore, setMineBefore] = useState<number | null>(null);
  const mine = useQuery(
    api.names.listNamesByOwner,
    isConnected && wallet ? { owner: wallet.address, limit: 50, before: mineBefore ?? undefined } : 'skip'
  );
  const refreshRecent = useAction(api.names.refreshNamesRecent);

  const onRefresh = useCallback(async () => {
    try { await refreshRecent({ pages: 5, limit: 100 }); } catch { }
  }, [refreshRecent]);

  useEffect(() => { setPage(0); }, [q, limit]);

  // Load ZEC names
  useEffect(() => {
    let cancelled = false;
    async function load(page: number) {
      setZecLoading(true);
      try {
        const res = await ordinalIndexAPI.getNames(page, limit, 'zec');
        if (cancelled) return;
        const mapped = (res.items || []).map((it: any) => {
          const tld = 'zec';
          const raw = (it.name || it.domain || '').toString();
          const lower = raw.toLowerCase();
          const suffix = `.${tld}`;
          const base = lower.endsWith(suffix) ? lower.slice(0, -suffix.length) : lower;
          return {
            _id: `${base}.${tld}`,
            name: base,
            tld,
            owner: (it.owner || '').toString(),
            inscriptionId: (it.inscription_id || it.inscriptionId || '').toString(),
          };
        });
        if (page === 0) setZecItems(mapped); else setZecItems((prev) => [...prev, ...mapped]);
        setZecHasMore(Boolean(res.has_more));
      } catch (e) {
        // keep calm
      } finally {
        if (!cancelled) setZecLoading(false);
      }
    }
    if (view === 'index' && !q.trim()) {
      load(zecPage);
    }
    return () => { cancelled = true; };
  }, [view, q, zecPage, limit]);

  // Load ZCASH names
  useEffect(() => {
    let cancelled = false;
    async function load(page: number) {
      setZcashLoading(true);
      try {
        const res = await ordinalIndexAPI.getNames(page, limit, 'zcash');
        if (cancelled) return;
        const mapped = (res.items || []).map((it: any) => {
          const tld = 'zcash';
          const raw = (it.name || it.domain || '').toString();
          const lower = raw.toLowerCase();
          const suffix = `.${tld}`;
          const base = lower.endsWith(suffix) ? lower.slice(0, -suffix.length) : lower;
          return {
            _id: `${base}.${tld}`,
            name: base,
            tld,
            owner: (it.owner || '').toString(),
            inscriptionId: (it.inscription_id || it.inscriptionId || '').toString(),
          };
        });
        if (page === 0) setZcashItems(mapped); else setZcashItems((prev) => [...prev, ...mapped]);
        setZcashHasMore(Boolean(res.has_more));
      } catch (e) {
        // keep calm
      } finally {
        if (!cancelled) setZcashLoading(false);
      }
    }
    if (view === 'index' && !q.trim()) {
      load(zcashPage);
    }
    return () => { cancelled = true; };
  }, [view, q, zcashPage, limit]);

  // Auto-ingest recent names if none loaded yet
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (recent && (recent.items?.length ?? 0) > 0) return;
      try {
        await refreshRecent({ pages: 10, limit: 200 });
      } catch { }
    })();
    return () => { cancelled = true; };
  }, [refreshRecent, recent?.items?.length]);

  const items = useMemo(() => {
    if (view === 'recent') return recent?.items ?? [];
    if (view === 'listings') return (listings ?? []).map((l: any) => ({
      _id: l._id,
      name: l.name,
      owner: l.sellerAddress,
      inscriptionId: '-',
      listing: l,
    }));
    if (view === 'mine') return mine?.items ?? [];
    if (view === 'index' && q.trim()) {
      const term = q.trim().toLowerCase();
      return [...zecItems, ...zcashItems].filter((r) => String(r.name || '').toLowerCase().includes(term));
    }
    if (q.trim()) return namesResp?.items ?? [];
    return []; // Index default handled separately
  }, [view, q, namesResp?.items, recent?.items, listings, mine?.items, zecItems, zcashItems]);

  const listingByName = useMemo(() => {
    const map = new Map<string, any>();
    (listings ?? []).forEach((l: any) => map.set((l.name || '').toLowerCase(), l));
    return map;
  }, [listings]);

  const isLoading = useMemo(() => {
    if (view === 'recent') return recent === undefined;
    if (view === 'listings') return listings === undefined;
    if (view === 'mine') return mine === undefined;
    if (view === 'index' && q.trim()) return zecLoading || zcashLoading;
    if (q.trim()) return namesResp === undefined;
    return false;
  }, [view, q, recent, listings, mine, namesResp, zecLoading, zcashLoading]);

  // Sorting for index view cards
  const [sortKey, setSortKey] = useState<'name' | 'length' | 'price'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const sortItems = useCallback((arr: any[]) => {
    const copy = [...(arr || [])];
    copy.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'price') {
        const ap = listings?.find?.((l: any) => (l.name || '').toLowerCase() === String(a.name || '').toLowerCase())?.priceZec ?? 0;
        const bp = listings?.find?.((l: any) => (l.name || '').toLowerCase() === String(b.name || '').toLowerCase())?.priceZec ?? 0;
        if (ap === bp) return dir * String(a.name || '').localeCompare(String(b.name || ''));
        return ap > bp ? dir : -dir;
      }
      if (sortKey === 'length') {
        const al = String(a.name || '').length;
        const bl = String(b.name || '').length;
        if (al === bl) return dir * String(a.name || '').localeCompare(String(b.name || ''));
        return al > bl ? dir : -dir;
      }
      // name
      return dir * String(a.name || '').localeCompare(String(b.name || ''));
    });
    return copy;
  }, [sortKey, sortDir, listings]);

  const sortedZec = useMemo(() => sortItems(zecItems), [zecItems, sortItems]);
  const sortedZcash = useMemo(() => sortItems(zcashItems), [zcashItems, sortItems]);

  return (
    <main className="relative min-h-screen text-gold-100 pt-20">
      <div className="fixed inset-0 w-full h-full opacity-15 -z-10">
        <Dither waveColor={[0.8, 0.6, 0.2]} disableAnimation={false} enableMouseInteraction={true} mouseRadius={0.3} colorNum={4} waveAmplitude={0.15} waveFrequency={2.2} waveSpeed={0.035} />
      </div>

      <div className="relative z-10 max-w-[1800px] mx-auto px-0 md:px-0 pb-16">
        {/* Slim Header / Filters Bar */}
        <div className="sticky top-20 z-30 mb-6 flex flex-col md:flex-row items-center gap-3 p-3 border border-gold-500/10 bg-black/80 backdrop-blur-md rounded-lg shadow-xl">
          {/* Left: Title & Refresh */}
          <div className="flex items-center gap-4 mr-auto">
            <h2 className="text-lg font-bold text-gold-100 tracking-tight whitespace-nowrap">
              Zcash Names
            </h2>
            <div className="h-4 w-px bg-gold-500/20" />
            <button
              onClick={onRefresh}
              className="group relative flex items-center gap-2 px-3 py-1.5 border border-gold-500/20 rounded hover:bg-gold-500/10 transition-all"
              title="Refresh Recent"
            >
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </div>
              <span className="text-[10px] uppercase tracking-wider font-bold text-gold-300 group-hover:text-gold-100">
                Sync
              </span>
            </button>
            {/* Register button removed per request */}
          </div>

          {/* Center: Search */}
          <div className="flex-1 w-full md:w-auto max-w-md relative group">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <svg className="w-3.5 h-3.5 text-gold-500/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search names..."
              className="w-full bg-black/40 border border-gold-500/20 rounded pl-9 pr-3 py-1.5 text-xs text-gold-100 placeholder:text-gold-500/30 focus:outline-none focus:border-gold-500/50 focus:ring-1 focus:ring-gold-500/20 transition-all"
            />
          </div>

          {/* Right: View Toggles + Sort */}
          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto no-scrollbar">
            <div className="flex items-center bg-black/40 rounded border border-gold-500/10 p-0.5">
              {[
                { id: 'index', label: 'Index' },
                { id: 'listings', label: 'Listings' },
                { id: 'recent', label: 'Recent' },
                { id: 'mine', label: 'My Names' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setView(tab.id as any)}
                  className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-all whitespace-nowrap ${view === tab.id
                    ? 'bg-gold-500 text-black shadow-sm'
                    : 'text-gold-500/50 hover:text-gold-300 hover:bg-white/5'
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {view === 'index' && (
              <div className="flex items-center gap-2 bg-black/40 rounded border border-gold-500/10 p-1">
                <span className="text-[10px] text-gold-500/60 uppercase tracking-wider">Sort</span>
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value as any)} className="bg-transparent text-[11px] text-gold-100 border border-gold-500/20 px-2 py-1">
                  <option value="name">Name</option>
                  <option value="length">Length</option>
                  <option value="price">Price</option>
                </select>
                <button onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')} className="px-2 py-1 text-[10px] border border-gold-500/20">
                  {sortDir === 'asc' ? 'ASC' : 'DESC'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Register bar removed per request */}

        {view === 'index' && !q.trim() ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* ZEC Column */}
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-gold-500/20 pb-2">
                <h3 className="text-lg font-bold text-gold-100">.zec</h3>
                <div className="flex gap-2">
                  <button
                    className="px-2 py-1 text-[10px] border border-gold-500/30 disabled:opacity-30"
                    onClick={() => { setZecPage(0); setZecItems([]); setZecHasMore(true); }}
                    disabled={zecPage === 0 && zecItems.length === 0}
                  >
                    Reset
                  </button>
                </div>
              </div>
              <NamesTable
                items={sortedZec}
                listingByName={listingByName}
                page={zecPage}
                limit={limit}
                setPage={setZecPage}
                hidePagination={true}
              />
              {zecHasMore && (
                <button
                  onClick={() => setZecPage(p => p + 1)}
                  disabled={zecLoading}
                  className="w-full py-2 text-xs border border-gold-500/20 hover:bg-gold-500/10 transition-colors disabled:opacity-50"
                >
                  {zecLoading ? 'Loading...' : 'Load More .zec'}
                </button>
              )}
            </div>

            {/* ZCASH Column */}
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-gold-500/20 pb-2">
                <h3 className="text-lg font-bold text-gold-100">.zcash</h3>
                <div className="flex gap-2">
                  <button
                    className="px-2 py-1 text-[10px] border border-gold-500/30 disabled:opacity-30"
                    onClick={() => { setZcashPage(0); setZcashItems([]); setZcashHasMore(true); }}
                    disabled={zcashPage === 0 && zcashItems.length === 0}
                  >
                    Reset
                  </button>
                </div>
              </div>
              <NamesTable
                items={sortedZcash}
                listingByName={listingByName}
                page={zcashPage}
                limit={limit}
                setPage={setZcashPage}
                hidePagination={true}
              />
              {zcashHasMore && (
                <button
                  onClick={() => setZcashPage(p => p + 1)}
                  disabled={zcashLoading}
                  className="w-full py-2 text-xs border border-gold-500/20 hover:bg-gold-500/10 transition-colors disabled:opacity-50"
                >
                  {zcashLoading ? 'Loading...' : 'Load More .zcash'}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <NamesTable
              items={items}
              listingByName={listingByName}
              total={view === 'index' ? undefined : (namesResp?.total ?? 0)}
              page={page}
              limit={limit}
              setPage={setPage}
              hidePagination={view === 'index'}
            />

            {items.length === 0 && (
              <div className="mt-6 text-center text-sm text-gold-300/70">
                {isLoading ? (
                  'Loading names…'
                ) : q.trim() ? (
                  'No names match your filter.'
                ) : view === 'recent' ? (
                  'No names found yet. Try "Refresh Recent" to ingest from chain.'
                ) : (
                  'No names found.'
                )}
              </div>
            )}

            {view === 'recent' && (
              <div className="mt-4 flex justify-center">
                <button
                  className="px-4 py-2 text-xs font-bold border border-gold-500/30"
                  onClick={() => setRecentBefore(recent?.nextBefore ?? null)}
                  disabled={!recent?.nextBefore}
                >
                  Load more
                </button>
              </div>
            )}

            {view === 'mine' && isConnected && (
              <div className="mt-4 flex justify-center">
                <button
                  className="px-4 py-2 text-xs font-bold border border-gold-500/30"
                  onClick={() => setMineBefore(mine?.nextBefore ?? null)}
                  disabled={!mine?.nextBefore}
                >
                  Load more
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function NamesTable({ items, listingByName, total, page, limit, setPage, hidePagination }: { items: any[]; listingByName: Map<string, any>; total?: number; page: number; limit: number; setPage: (p: number) => void; hidePagination?: boolean }) {
  const totalPages = Math.max(1, Math.ceil((total ?? 1) / limit));
  const renderNameCard = (row: any, idx: number) => {
    const listing = listingByName.get((row.name || '').toLowerCase());
    const base = String(row.name || '');
    const lower = base.toLowerCase();
    const hasTld = lower.endsWith('.zec') || lower.endsWith('.zcash');
    const tld = String(row.tld || 'zec');
    const display = hasTld ? base : `${base}.${tld}`;
    const slug = lower.replace(/\.(zec|zcash)$/i, '');
    // Simple hunter badges
    const len = base.length;
    const isShort = len <= 4;
    const isNumeric = /^\d+$/.test(base);
    const hasEmoji = /[\u{1F300}-\u{1FAFF}]/u.test(base);
    const hasHyphen = base.includes('-');
    const isPalindrome = base === base.split('').reverse().join('');
    return (
      <div key={row._id || `${slug}-${idx}`} className="group bg-black/40 border border-gold-500/10 rounded-md p-3 hover:bg-white/5 transition-colors">
        <div className="flex items-start justify-between">
          <div className="text-gold-100 font-bold tracking-wide">
            <Link href={`/names/${slug}`} className="hover:text-gold-400 transition-colors">{display}</Link>
          </div>
          {listing && (
            <div className="text-green-400 font-mono text-xs font-bold">{formatZec(listing.priceZec)}</div>
          )}
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] text-gold-500/50">
          <span className="font-mono">{shortAddress(row.owner)}</span>
          <span className="font-mono">{tld.toUpperCase()}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {isShort && <span className="px-2 py-0.5 text-[10px] border border-gold-500/20 text-gold-300/80">SHORT</span>}
          {isNumeric && <span className="px-2 py-0.5 text-[10px] border border-gold-500/20 text-gold-300/80">NUM</span>}
          {hasEmoji && <span className="px-2 py-0.5 text-[10px] border border-gold-500/20 text-gold-300/80">EMOJI</span>}
          {hasHyphen && <span className="px-2 py-0.5 text-[10px] border border-gold-500/20 text-gold-300/80">HYPHEN</span>}
          {isPalindrome && <span className="px-2 py-0.5 text-[10px] border border-gold-500/20 text-gold-300/80">PAL</span>}
        </div>
        <div className="mt-2 flex gap-2 opacity-60 group-hover:opacity-100">
          {listing ? (
            <button className="px-3 py-1 text-[10px] font-bold bg-gold-500 text-black uppercase tracking-wider rounded hover:bg-gold-400 transition-colors">Buy</button>
          ) : (
            <ListForSaleButton name={row.name} owner={row.owner} />
          )}
        </div>
      </div>
    );
  };

  if (hidePagination) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((row, idx) => renderNameCard(row, idx))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gold-500/10 bg-black/40 backdrop-blur-sm shadow-lg">
      <table className="min-w-full text-xs md:text-sm">
        <thead className="bg-white/5 text-gold-300/70 uppercase tracking-wider text-[10px] font-medium border-b border-gold-500/10">
          <tr>
            <th className="px-4 py-3 text-left font-normal">#</th>
            <th className="px-4 py-3 text-left font-normal">Name</th>
            <th className="px-4 py-3 text-left font-normal">Owner</th>
            <th className="px-4 py-3 text-left font-normal">Listing</th>
            <th className="px-4 py-3 text-left font-normal">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gold-500/5">
          {items.map((row, idx) => {
            const listing = listingByName.get((row.name || '').toLowerCase());
            const base = String(row.name || '');
            const lower = base.toLowerCase();
            const hasTld = lower.endsWith('.zec') || lower.endsWith('.zcash');
            const tld = String(row.tld || 'zec');
            const display = hasTld ? base : `${base}.${tld}`;
            const slug = lower.replace(/\.(zec|zcash)$/i, '');
            return (
              <tr key={row._id} className="group hover:bg-white/5 transition-colors">
                <td className="px-4 py-3 text-gold-500/40 font-mono text-[10px]">{page * limit + idx + 1}</td>
                <td className="px-4 py-3">
                  <div className="font-bold text-gold-100 tracking-wide">
                    <Link href={`/names/${slug}`} className="hover:text-gold-400 transition-colors">
                      {display}
                    </Link>
                  </div>
                  <div className="text-[10px] text-gold-500/40 font-mono mt-0.5">{row.inscriptionId || '—'}</div>
                </td>
                <td className="px-4 py-3 font-mono text-gold-300/80 text-[11px]">{shortAddress(row.owner)}</td>
                <td className="px-4 py-3">{listing ? <span className="text-green-400 font-mono font-bold">{formatZec(listing.priceZec)}</span> : <span className="text-gold-500/20">—</span>}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                    {listing ? (
                      <button className="px-3 py-1 text-[10px] font-bold bg-gold-500 text-black uppercase tracking-wider rounded hover:bg-gold-400 transition-colors">Buy</button>
                    ) : (
                      <ListForSaleButton name={row.name} owner={row.owner} />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {!hidePagination && typeof total === 'number' && (
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-4 py-3 text-xs text-gold-500/50 border-t border-gold-500/10 bg-black/20">
          <div>Page {page + 1} / {totalPages}</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="px-3 py-1 border border-gold-500/20 rounded hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">Prev</button>
            <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="px-3 py-1 border border-gold-500/20 rounded hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

function InlineRegister() {
  const { wallet, isConnected } = useWallet();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const canRegister = isConnected && wallet && name.trim().length >= 3;

  return (
    <div className="border border-gold-500/10 bg-black/40 backdrop-blur-sm p-4 rounded-lg shadow-lg">
      <div className="flex flex-col md:flex-row items-center gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value.replace(/[^a-z0-9-]/g, '').toLowerCase()); setError(null); setOk(null); }}
          placeholder="Register a name (3-32 chars, a-z, 0-9, -)"
          className="flex-1 bg-black/40 border border-gold-500/20 rounded px-4 py-2.5 text-sm text-gold-100 placeholder:text-gold-500/30 focus:outline-none focus:border-gold-500/50 focus:ring-1 focus:ring-gold-500/20 transition-all"
        />
        <button
          disabled={!canRegister || submitting}
          onClick={async () => {
            if (!wallet) return;
            setSubmitting(true);
            setError(null);
            setOk(null);
            try {
              const res = await registerZcashName(wallet.privateKey as any, wallet.address, name);
              setOk(`Broadcasted: ${res.txid.slice(0, 8)}…`);
            } catch (e: any) {
              setError(e?.message || 'Failed to register');
            } finally {
              setSubmitting(false);
            }
          }}
          className="px-6 py-2.5 text-xs font-bold bg-gold-500 text-black uppercase tracking-wider rounded hover:bg-gold-400 transition-colors disabled:opacity-50 disabled:hover:bg-gold-500"
        >
          {submitting ? 'Registering…' : 'Register'}
        </button>
      </div>
      <div className="mt-2 text-xs pl-1">
        {error && <span className="text-red-400">{error}</span>}
        {ok && <span className="text-green-400">{ok}</span>}
      </div>
    </div>
  );
}

function shortAddress(addr: string) {
  if (!addr) return '—';
  return addr.length <= 12 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function ListForSaleButton({ name, owner }: { name: string; owner: string }) {
  const { wallet, isConnected } = useWallet();
  const createListing = useMutation(api.names.createNameListing);
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(1);

  if (!isConnected || !wallet) return <span className="text-gold-500/30 text-[10px]">Connect wallet</span>;
  const mine = wallet.address?.toLowerCase() === (owner || '').toLowerCase();
  if (!mine) return <span className="text-gold-500/30 text-[10px]">Not owner</span>;

  return (
    <>
      {!open ? (
        <button onClick={() => setOpen(true)} className="px-3 py-1 text-[10px] font-bold border border-gold-500/30 text-gold-300 uppercase tracking-wider rounded hover:bg-gold-500/10 transition-colors">List</button>
      ) : (
        <div className="flex items-center gap-2 bg-black/60 p-1 rounded border border-gold-500/20">
          <input type="number" value={price} min={0} step={0.0001} onChange={(e) => setPrice(Number(e.target.value))} className="w-20 bg-transparent border-b border-gold-500/30 px-1 py-0.5 text-xs text-gold-100 focus:outline-none focus:border-gold-500" />
          <button
            onClick={async () => {
              try {
                await createListing({ name, priceZec: price, sellerAddress: wallet.address });
                setOpen(false);
              } catch (e) { console.error(e); }
            }}
            className="px-2 py-1 text-[10px] font-bold bg-gold-500 text-black uppercase tracking-wider rounded hover:bg-gold-400"
          >Post</button>
          <button onClick={() => setOpen(false)} className="px-2 py-1 text-[10px] text-gold-500 hover:text-gold-300">✕</button>
        </div>
      )}
    </>
  );
}
