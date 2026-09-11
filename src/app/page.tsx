'use client';

/**
 * Coming-soon landing page.
 *
 * The previous marketplace homepage is retained verbatim at /market — it is not deleted, only
 * moved (see src/app/market/page.tsx). Every other route is untouched.
 *
 * Deliberately self-contained: no Convex, no indexer, no RPC. Those backends are being restarted
 * (docs/RESTART_REPORT.md), so this page must render while they are all down. Its only network
 * call is POST /api/waitlist.
 *
 * Styled with Tailwind like the rest of the site. (styled-jsx was tried first and rejected: its
 * scoped class is not applied to child components such as next/image, so the logo went unstyled.)
 */

import { useState } from 'react';

type Status = 'idle' | 'sending' | 'done' | 'error';

export default function ComingSoon() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === 'sending') return;
    setStatus('sending');
    setMessage('');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus('error');
        setMessage(data.error || 'Something went wrong. Try again.');
        return;
      }
      setStatus('done');
      setMessage(data.already ? 'You are already on the list.' : 'You are on the list.');
    } catch {
      setStatus('error');
      setMessage('Network error. Try again.');
    }
  }

  return (
    <main className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-[#050506] px-5 py-12 text-[#f5f1e6]">
      {/* faint scan grid — echoes the terminal look of the rest of the site */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,200,55,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,200,55,0.05) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse at 50% 38%, #000 25%, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 38%, #000 25%, transparent 78%)',
        }}
      />
      {/* horizon glow, matching the mobile app's login screen */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 h-[128vw] w-[128vw] -translate-x-1/2 rounded-full"
        style={{
          bottom: '-114vw',
          background:
            'radial-gradient(circle at 50% 50%, transparent 68%, rgba(255,200,55,0.17) 69.4%, rgba(255,200,55,0.05) 71%, transparent 74%)',
        }}
      />

      <section className="relative w-full max-w-[560px] text-center">
        {/* plain <img>: next/image buys nothing for a single above-the-fold logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/zlogo.png"
          alt="Zatoshi"
          width={132}
          height={132}
          className="mx-auto h-auto w-[112px] sm:w-[132px]"
          style={{ filter: 'drop-shadow(0 0 34px rgba(255,200,55,0.34))' }}
        />

        <h1 className="mt-6 text-[clamp(24px,7vw,40px)] font-normal tracking-[0.14em] text-gold-500">
          ZATOSHI.MARKET
        </h1>
        <p className="mt-3 text-[clamp(13px,3.6vw,17px)] leading-relaxed text-[#9a948a]">
          Zcash inscriptions and runes.
          <br />
          Solana rails.
        </p>

        {status === 'done' ? (
          <div
            role="status"
            className="mx-auto mt-9 max-w-[460px] rounded-2xl border border-gold-500/40 bg-gold-500/10 p-5 text-[15px] text-gold-500"
          >
            <span className="font-bold">✓</span> {message}
            <p className="mt-2 text-[13px] text-[#9a948a]">
              We will email your invite when the app opens.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="mx-auto mt-9 max-w-[460px] text-left">
            <label htmlFor="email" className="mb-2 block text-xs tracking-[0.22em] text-gold-500">
              Request access
            </label>
            <div className="flex flex-wrap gap-2.5">
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === 'sending'}
                className="min-w-0 flex-[1_1_200px] rounded-xl border border-[#2a2d31] bg-[#101114] px-4 py-4 text-[15px] text-[#f5f1e6] outline-none placeholder:text-[#5d5a54] focus:border-gold-500 focus:ring-2 focus:ring-gold-500/20 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={status === 'sending'}
                className="flex-none rounded-xl bg-gradient-to-br from-gold-300 via-gold-500 to-gold-700 px-6 py-4 text-[14px] tracking-wider text-[#0a0a0b] shadow-[0_6px_22px_rgba(255,200,55,0.28)] disabled:opacity-60"
              >
                {status === 'sending' ? 'SENDING…' : 'REQUEST INVITE'}
              </button>
            </div>
            {status === 'error' && <p className="mt-3 text-[13px] text-red-300">{message}</p>}
            <p className="mt-3 text-xs text-[#6f6b64]">Invite-only at launch. One email, no spam.</p>
          </form>
        )}

        <div className="mt-10 flex flex-wrap items-center justify-center gap-2.5">
          <a
            href="https://x.com/zatoshimarket"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-[#2a2d31] px-4 py-2.5 text-xs text-[#9a948a] transition-colors hover:border-gold-500/50 hover:text-gold-500"
          >
            <XIcon />
            @zatoshimarket
          </a>
          <ContractChip />
        </div>

        <p className="mt-5 text-[13px] leading-relaxed text-[#6f6b64]">
          Shipping to the Seeker and iOS: inscribe on Zcash, pay with SKR or USDC on Solana.
        </p>
        <p className="mt-2 inline-flex items-center gap-2 text-[13px] text-[#6f6b64]">
          <span
            aria-hidden
            className="h-[7px] w-[7px] flex-none rounded-full bg-[#7ee787] shadow-[0_0_10px_#7ee787]"
          />
          <span>
            {'Clocked in for '}
            <span className="text-gold-500">CLOCK IN</span>
            {', a Solana Mobile hackathon by RadiantsDAO'}
          </span>
        </p>

        <nav className="mt-7 flex justify-center gap-3 text-[13px] text-[#5d5a54]">
          <a href="/market" className="text-[#9a948a] transition-colors hover:text-gold-500">
            Explorer
          </a>
        </nav>
      </section>
    </main>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5 fill-current">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/**
 * Token contract address. Unset until the token exists, so the chip shows "TBA" rather than a
 * placeholder that could be mistaken for a real address. Set NEXT_PUBLIC_CONTRACT_ADDRESS to
 * reveal it, and it becomes click-to-copy.
 */
function ContractChip() {
  const address = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS?.trim();
  const [copied, setCopied] = useState(false);

  if (!address) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-dashed border-[#2a2d31] px-4 py-2.5 text-xs text-[#6f6b64]">
        CONTRACT: TBA
      </span>
    );
  }

  const short = `${address.slice(0, 4)}…${address.slice(-4)}`;

  return (
    <button
      type="button"
      title={address}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard blocked; the full address is in the title attribute */
        }
      }}
      className="inline-flex items-center gap-2 rounded-full border border-[#2a2d31] px-4 py-2.5 text-xs text-[#9a948a] transition-colors hover:border-gold-500/50 hover:text-gold-500"
    >
      <span className="text-[#6f6b64]">CONTRACT</span>
      <span className="font-mono">{short}</span>
      <span className="text-gold-500">{copied ? '✓' : '⧉'}</span>
    </button>
  );
}
