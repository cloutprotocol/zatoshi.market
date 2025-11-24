'use client';

export function ProfileHeaderSkeleton() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-gold-500/20 bg-black/40 p-6 shadow-xl">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
        <div className="flex flex-col items-center text-center lg:flex-row lg:text-left lg:gap-6">
          <div className="h-24 w-24 rounded-full border-2 border-gold-400/20 bg-gold-500/5 animate-pulse" />
          <div className="space-y-2">
            <div className="h-6 w-48 rounded bg-gold-500/10 animate-pulse" />
            <div className="h-4 w-32 rounded bg-gold-500/10 animate-pulse" />
            <div className="flex gap-2">
              <div className="h-6 w-32 rounded-full border border-gold-500/20 bg-gold-500/5 animate-pulse" />
              <div className="h-6 w-24 rounded-full border border-gold-500/20 bg-gold-500/5 animate-pulse" />
            </div>
          </div>
        </div>
        <div className="flex-1 space-y-3">
          <div className="h-4 w-full rounded bg-gold-500/10 animate-pulse" />
          <div className="h-4 w-3/4 rounded bg-gold-500/10 animate-pulse" />
          <div className="flex gap-2">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className="h-8 w-24 rounded-full border border-gold-500/10 bg-gold-500/5 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
