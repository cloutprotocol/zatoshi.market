import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6">
      <div className="max-w-md w-full bg-black/40 border border-gold-500/30 rounded-lg p-8 backdrop-blur-xl text-center">
        <h2 className="text-4xl font-bold text-gold-300 mb-4">404</h2>
        <p className="text-gold-200/60 mb-6">Page not found</p>
        <Link
          href="/"
          className="inline-block px-6 py-3 bg-gold-500 text-black font-bold rounded-lg hover:bg-gold-400 transition-all"
        >
          Return Home
        </Link>
      </div>
    </div>
  );
}
