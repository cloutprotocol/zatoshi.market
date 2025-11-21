"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getConvexClient } from "@/lib/convexClient";
import { api } from "../../convex/_generated/api";

type Insc = {
  _id: string;
  inscriptionId: string;
  txid: string;
  address: string;
  contentType: string;
  contentPreview: string;
  contentSize: number;
  type: string;
  createdAt: number;
};

export function InscriptionHistory({ address, limit = 50 }: { address: string; limit?: number }) {
  const [data, setData] = useState<Insc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const short = useMemo(() => `${address.slice(0, 6)}...${address.slice(-4)}`, [address]);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const convex = getConvexClient();
      if (!convex) throw new Error("Convex client not available");
      const res = await convex.query(api.inscriptions.getInscriptionsByAddress, { address, limit } as any);
      setData((res as any) || []);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [address, limit]);

  return (
    <section className="mt-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <h3 className="text-lg font-semibold">Your Mint History</h3>
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-0.5 rounded bg-black/40 border border-gold-500/30 text-gold-300 whitespace-nowrap">{short}</span>
          <button onClick={load} className="px-3 py-1 bg-black/60 border border-gold-500/40 rounded hover:border-gold-500/60">Refresh</button>
        </div>
      </div>
      {error && <div className="mb-2 text-xs text-red-400">{error}</div>}

      <div className="overflow-x-auto border border-gold-500/20 rounded bg-black/20">
        <table className="w-full text-left text-xs min-w-[720px]">
          <thead className="bg-black/40 text-gold-300/80 uppercase tracking-wide">
            <tr>
              <th className="p-2.5">Time</th>
              <th className="p-2.5">Tx</th>
              <th className="p-2.5">Type</th>
              <th className="p-2.5">Size</th>
              <th className="p-2.5">Inscription</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gold-500/10">
            {loading && (
              <tr>
                <td className="p-2.5 text-gold-400/70" colSpan={5}>Loading…</td>
              </tr>
            )}
            {!loading && data.length === 0 && (
              <tr>
                <td className="p-2.5 text-gold-400/70" colSpan={5}>No inscriptions yet.</td>
              </tr>
            )}
            {!loading && data.map((r) => (
              <tr key={r._id} className="hover:bg-gold-500/5 transition-colors">
                <td className="p-2.5 whitespace-nowrap text-gold-200/80">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="p-2.5">
                  <a className="font-mono underline hover:text-gold-100" href={`https://blockchair.com/zcash/transaction/${r.txid}`} target="_blank" rel="noreferrer">
                    {r.txid.slice(0, 16)}…
                  </a>
                </td>
                <td className="p-2.5 whitespace-nowrap text-gold-200/80 uppercase">{r.type}</td>
                <td className="p-2.5 whitespace-nowrap text-gold-200/80">{r.contentSize?.toLocaleString?.() || r.contentSize} B</td>
                <td className="p-2.5">
                  <Link className="font-mono underline hover:text-gold-100 break-all" href={`/inscription/${r.inscriptionId}`}>
                    {r.inscriptionId}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
