'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { getConvexClient } from '@/lib/convexClient';
import { api } from '../../../../convex/_generated/api';

type Job = {
  _id: string;
  type: string;
  status: string;
  totalCount: number;
  completedCount: number;
  inscriptionIds: string[];
  createdAt: number;
  updatedAt: number;
  error?: string;
};

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const convex = getConvexClient();
      if (!convex) throw new Error('Service not available. Please try again in a moment.');
      const list = await convex.query(api.jobs.listJobs, {} as any);
      setJobs(list as any);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);

  const retry = async (id: string) => {
    const convex = getConvexClient(); if (!convex) return;
    await convex.action(api.jobsActions.retryJob, { jobId: id as any });
    load();
  };
  const cancel = async (id: string) => {
    const convex = getConvexClient(); if (!convex) return;
    await convex.action(api.jobsActions.cancelJob, { jobId: id as any });
    load();
  };

  return (
    <main className="min-h-screen bg-black text-gold-300 p-6">
      <div className="container mx-auto">
        <h1 className="text-2xl font-bold mb-4">Jobs</h1>
        {error && <div className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">{error}</div>}
        <div className="space-y-3">
          {loading && <div className="text-gold-400/70 text-sm">Loading…</div>}
          {jobs.map((job) => (
            <div key={job._id} className="p-4 bg-black/40 border border-gold-500/20 rounded">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-gold-400/80">
                  {job.type} • <Link href={`/admin/jobs/${job._id}`} className="underline font-mono">{job._id}</Link>
                </div>
                <div className="text-xs text-gold-400/70">Updated: {new Date(job.updatedAt).toLocaleString()}</div>
              </div>
              <div className="flex items-center justify-between text-sm mb-2">
                <div>Status: <span className="font-semibold">{job.status}</span>{job.error ? ` — ${job.error}` : ''}</div>
                <div>{job.completedCount}/{job.totalCount}</div>
              </div>
              <div className="w-full h-2 bg-black/60 border border-gold-500/30 rounded mb-2">
                <div className="h-full bg-gold-500 rounded" style={{ width: `${Math.min(100, (job.completedCount / Math.max(1, job.totalCount)) * 100)}%` }} />
              </div>
              <div className="flex gap-2 text-xs">
                <button onClick={()=>retry(job._id)} className="px-3 py-1 bg-gold-500 text-black rounded">Retry</button>
                <button onClick={()=>cancel(job._id)} className="px-3 py-1 bg-black/60 border border-gold-500/40 rounded">Cancel</button>
              </div>
              {job.inscriptionIds?.length ? (
                <div className="mt-3 text-xs text-gold-300 max-h-32 overflow-auto space-y-1">
                  {job.inscriptionIds.map((id, idx)=>(
                    <div key={idx}>
                      {idx+1}. <a className="underline" href={`https://zerdinals.com/zerdinals/${id}`} target="_blank" rel="noreferrer">{id}</a>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
