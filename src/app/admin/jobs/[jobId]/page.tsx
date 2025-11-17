'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getConvexClient } from '@/lib/convexClient';
import { api } from '../../../../../convex/_generated/api';

type Job = {
  _id: string;
  type: string;
  status: string;
  params: any;
  totalCount: number;
  completedCount: number;
  inscriptionIds: string[];
  createdAt: number;
  updatedAt: number;
  error?: string;
};

export default function JobDetailPage({ params }: { params: { jobId: string } }) {
  const jobId = params.jobId;
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const convex = getConvexClient();
      if (!convex) throw new Error('Service not available. Please try again in a moment.');
      const j = await convex.query(api.jobs.getJob, { jobId: jobId as any });
      setJob(j as any);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [jobId]);

  const progressPct = useMemo(() => {
    if (!job) return 0; return Math.min(100, (job.completedCount / Math.max(1, job.totalCount)) * 100);
  }, [job]);

  const retry = async () => {
    const convex = getConvexClient(); if (!convex || !job) return;
    await convex.action(api.jobsActions.retryJob, { jobId: job._id as any });
    load();
  };
  const cancel = async () => {
    const convex = getConvexClient(); if (!convex || !job) return;
    await convex.action(api.jobsActions.cancelJob, { jobId: job._id as any });
    load();
  };

  return (
    <main className="min-h-screen bg-black text-gold-300 p-6">
      <div className="container mx-auto max-w-5xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Job Detail</h1>
          <Link href="/admin/jobs" className="text-gold-400 underline">Back to Jobs</Link>
        </div>

        {error && <div className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">{error}</div>}
        {loading && <div className="text-gold-400/70 text-sm">Loading…</div>}

        {job && (
          <div className="space-y-6">
            <section className="p-4 bg-black/40 border border-gold-500/20 rounded">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-gold-400/80">ID: <span className="font-mono">{job._id}</span></div>
                <div className="text-xs text-gold-400/70">Updated: {new Date(job.updatedAt).toLocaleString()}</div>
              </div>
              <div className="text-sm mb-2">Type: <span className="font-semibold">{job.type}</span></div>
              <div className="text-sm mb-2">Status: <span className="font-semibold">{job.status}</span>{job.error ? ` — ${job.error}` : ''}</div>
              <div className="w-full h-2 bg-black/60 border border-gold-500/30 rounded mb-2">
                <div className="h-full bg-gold-500 rounded" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="text-xs text-gold-400/80">Progress: {job.completedCount}/{job.totalCount}</div>
              <div className="mt-3 flex gap-2 text-xs">
                <button onClick={retry} className="px-3 py-1 bg-gold-500 text-black rounded">Retry</button>
                <button onClick={cancel} className="px-3 py-1 bg-black/60 border border-gold-500/40 rounded">Cancel</button>
              </div>
            </section>

            <section className="p-4 bg-black/40 border border-gold-500/20 rounded">
              <h2 className="font-semibold mb-2">Parameters</h2>
              <pre className="text-xs text-gold-300/90 bg-black/60 border border-gold-500/20 rounded p-3 overflow-auto max-h-64">
                {JSON.stringify(job.params, null, 2)}
              </pre>
            </section>

            <section className="p-4 bg-black/40 border border-gold-500/20 rounded">
              <h2 className="font-semibold mb-2">Inscriptions</h2>
              {job.inscriptionIds?.length ? (
                <div className="space-y-2 max-h-80 overflow-auto text-xs">
                  {job.inscriptionIds.map((iid, idx) => {
                    const reveal = iid.includes('i') ? iid.split('i')[0] : iid;
                    return (
                      <div key={idx} className="flex items-center justify-between gap-2">
                        <div className="truncate mr-2">{idx+1}. <span className="font-mono">{iid}</span></div>
                        <div className="flex gap-2 flex-shrink-0">
                          <span className="text-gold-400/70">Commit: N/A</span>
                          <a className="underline" href={`https://zerdinals.com/zerdinals/${iid}`} target="_blank" rel="noreferrer">View Inscription</a>
                          <a className="underline" href={`https://blockchair.com/zcash/transaction/${reveal}`} target="_blank" rel="noreferrer">Reveal TX</a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-gold-400/70 text-sm">No inscriptions recorded.</div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
