'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6">
      <div className="max-w-md w-full bg-black/40 border border-gold-500/30 rounded-lg p-8 backdrop-blur-xl">
        <h2 className="text-2xl font-bold text-gold-300 mb-4">Something went wrong!</h2>
        <p className="text-gold-200/60 mb-6">{error.message}</p>
        <button
          onClick={reset}
          className="px-6 py-3 bg-gold-500 text-black font-bold rounded-lg hover:bg-gold-400 transition-all"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
