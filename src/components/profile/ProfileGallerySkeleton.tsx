'use client';

export function ProfileGallerySkeleton({ count = 6 }: { count?: number }) {
  return (
    <section className="space-y-8">
      <div>
        <div className="mb-3 h-5 w-40 rounded bg-gold-500/10 animate-pulse" />
        <div className="flex gap-4 overflow-x-auto pb-2">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={`pin-skel-${idx}`} className="w-64 flex-shrink-0">
              <div className="aspect-square rounded-xl border border-gold-500/20 bg-gold-500/5 animate-pulse" />
              <div className="mt-3 h-4 w-32 rounded bg-gold-500/10 animate-pulse" />
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-3 h-5 w-32 rounded bg-gold-500/10 animate-pulse" />
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: count }).map((_, idx) => (
            <div key={`gallery-skel-${idx}`} className="rounded-xl border border-gold-500/20 bg-black/40 p-3">
              <div className="aspect-square rounded-sm bg-gold-500/5 animate-pulse" />
              <div className="mt-3 space-y-2">
                <div className="h-4 w-28 rounded bg-gold-500/10 animate-pulse" />
                <div className="h-4 w-36 rounded bg-gold-500/10 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
