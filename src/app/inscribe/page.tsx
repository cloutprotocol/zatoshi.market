'use client';

import { useState } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import Link from 'next/link';
import { inscribe, mintZRC20Token, registerZcashName } from '@/services/inscription';
import {
  PLATFORM_FEES,
  calculateTotalCost,
  formatZEC,
  formatUSD,
  isValidZcashName,
  zatoshisToZEC
} from '@/config/fees';
import { useZecPrice } from '@/hooks/useZecPrice';
import { FeeBreakdown } from '@/components/FeeBreakdown';

export default function InscribePage() {
  const { wallet, isConnected } = useWallet();
  const { price: zecPrice, loading: priceLoading, error: priceError } = useZecPrice();
  const [activeTab, setActiveTab] = useState<'names' | 'text' | 'zrc20'>('names');

  // Name registration form
  const [nameInput, setNameInput] = useState('');
  const [nameExtension, setNameExtension] = useState<'zec' | 'zcash'>('zec');
  const [nameError, setNameError] = useState<string | null>(null);

  // Text inscription form
  const [textContent, setTextContent] = useState('');
  const [contentType, setContentType] = useState('text/plain');

  // ZRC-20 form
  const [tick, setTick] = useState('');
  const [amount, setAmount] = useState('');

  // Status
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ txid: string; inscriptionId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fullName = `${nameInput}.${nameExtension}`;

  // Validate name in real-time
  const validateName = (name: string) => {
    if (!name) {
      setNameError(null);
      return;
    }
    const validation = isValidZcashName(`${name}.${nameExtension}`);
    setNameError(validation.valid ? null : validation.error || null);
  };

  const handleNameRegistration = async () => {
    if (!wallet?.privateKey || !wallet?.address) {
      setError('Please connect your wallet first');
      return;
    }

    if (!nameInput.trim()) {
      setError('Please enter a name');
      return;
    }

    const validation = isValidZcashName(fullName);
    if (!validation.valid) {
      setError(validation.error || 'Invalid name');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const result = await registerZcashName(
        wallet.privateKey,
        wallet.address,
        fullName
      );

      setResult(result);
      setNameInput('');
    } catch (err) {
      console.error('Name registration error:', err);
      setError(err instanceof Error ? err.message : 'Failed to register name');
    } finally {
      setLoading(false);
    }
  };

  const handleTextInscription = async () => {
    if (!wallet?.privateKey || !wallet?.address) {
      setError('Please connect your wallet first');
      return;
    }

    if (!textContent.trim()) {
      setError('Please enter content to inscribe');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const result = await inscribe(
        wallet.privateKey,
        wallet.address,
        contentType,
        textContent
      );

      setResult(result);
      setTextContent('');
    } catch (err) {
      console.error('Inscription error:', err);
      setError(err instanceof Error ? err.message : 'Failed to create inscription');
    } finally {
      setLoading(false);
    }
  };

  const handleZRC20Mint = async () => {
    if (!wallet?.privateKey || !wallet?.address) {
      setError('Please connect your wallet first');
      return;
    }

    if (!tick.trim() || !amount.trim()) {
      setError('Please enter ticker and amount');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const result = await mintZRC20Token(
        wallet.privateKey,
        wallet.address,
        tick,
        amount
      );

      setResult(result);
      setTick('');
      setAmount('');
    } catch (err) {
      console.error('Mint error:', err);
      setError(err instanceof Error ? err.message : 'Failed to mint ZRC-20 token');
    } finally {
      setLoading(false);
    }
  };

  const nameCost = calculateTotalCost(PLATFORM_FEES.NAME_REGISTRATION);
  const textCost = calculateTotalCost(PLATFORM_FEES.INSCRIPTION);
  const zrc20Cost = calculateTotalCost(PLATFORM_FEES.INSCRIPTION);

  return (
    <main className="min-h-screen bg-black text-gold-300 pt-20 pb-8">
      <div className="container mx-auto px-4 sm:px-6 mt-8">
        <div className="flex flex-col lg:flex-row gap-4 sm:gap-6">
          {/* Left Sidebar - Tabs */}
          <div className="lg:w-64 flex-shrink-0">
            {/* Mobile: Horizontal Scrolling Tabs */}
            <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0 -mx-4 px-4 lg:mx-0 lg:px-0">
              <button
                onClick={() => setActiveTab('names')}
                className={`flex-shrink-0 lg:w-full text-left px-8 sm:px-6 sm:py-4 rounded-lg rounded-lg font-bold transition-all ${
                  activeTab === 'names'
                    ? 'bg-gold-500 text-black shadow-sm shadow-gold-500/50'
                    : 'bg-black/40 border border-gold-500/30 text-gold-400 hover:border-gold-500/50'
                }`}
              >
                <div className="text-base sm:text-lg whitespace-nowrap lg:whitespace-normal">Names</div>
                <div className="text-xs opacity-75 hidden sm:block">.zec • .zcash</div>
              </button>

              <button
                onClick={() => setActiveTab('text')}
                className={`flex-shrink-0 lg:w-full text-left px-8 sm:px-6 sm:py-4 rounded-lg font-bold transition-all ${
                  activeTab === 'text'
                    ? 'bg-gold-500 text-black shadow-sm shadow-gold-500/50'
                    : 'bg-black/40 border border-gold-500/30 text-gold-400 hover:border-gold-500/50'
                }`}
              >
                <div className="text-base sm:text-lg whitespace-nowrap lg:whitespace-normal">Text</div>
                <div className="text-xs opacity-75 hidden sm:block">Inscriptions</div>
              </button>

              <button
                onClick={() => setActiveTab('zrc20')}
                className={`flex-shrink-0 lg:w-full text-left px-8 sm:px-6 sm:py-4 rounded-lg rounded-lg font-bold transition-all ${
                  activeTab === 'zrc20'
                    ? 'bg-gold-500 text-black shadow-sm shadow-gold-500/50'
                    : 'bg-black/40 border border-gold-500/30 text-gold-400 hover:border-gold-500/50'
                }`}
              >
                <div className="text-base sm:text-lg whitespace-nowrap lg:whitespace-normal">ZRC-20</div>
                <div className="text-xs opacity-75 hidden sm:block">Token Mint</div>
              </button>
            </div>

            {/* Fee Info - Hidden on mobile */}
            <div className="hidden lg:block mt-8 p-4 bg-black/40 border border-gold-500/20 rounded-lg">
              <div className="text-xs text-gold-400/60 mb-2">Platform Fees</div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-gold-400/80">Inscriptions</span>
                  <span className="text-gold-300 font-mono">{formatZEC(PLATFORM_FEES.INSCRIPTION)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 bg-black/40 border border-none rounded-xl sm:rounded-2xl backdrop-blur-xl p-4 sm:p-4 lg:p-4">
            {/* NAME REGISTRATION TAB */}
            {activeTab === 'names' && (
              <div className="max-w-2xl mx-auto">
                <div className="text-center mb-8 sm:mb-12">
                  <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-2 sm:mb-3">Register Your Zcash Name</h2>
                  <p className="text-gold-400/60 text-sm sm:text-base lg:text-lg">
                    Secure your .zec or .zcash identity on the blockchain
                  </p>
                </div>

                {/* Name Search Box */}
                <div className="mb-6 sm:mb-8">
                  <div className="relative">
                    <div className="flex flex-col sm:flex-row gap-0 bg-black/60 border-2 border-gold-500/50 rounded-xl overflow-hidden focus-within:border-gold-500 transition-all">
                      <input
                        type="text"
                        value={nameInput}
                        onChange={(e) => {
                          const value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                          setNameInput(value);
                          validateName(value);
                        }}
                        className="flex-1 bg-transparent px-4 sm:px-6 py-4 sm:py-5 text-xl sm:text-2xl font-mono text-gold-300 placeholder-gold-500/40 outline-none"
                        placeholder="yourname"
                        disabled={loading}
                      />
                      <select
                        value={nameExtension}
                        onChange={(e) => {
                          setNameExtension(e.target.value as 'zec' | 'zcash');
                          validateName(nameInput);
                        }}
                        className="bg-black/60 border-t sm:border-t-0 sm:border-l border-gold-500/30 px-4 sm:px-8 py-4 sm:py-5 text-xl sm:text-2xl font-mono text-gold-300 outline-none cursor-pointer"
                        disabled={loading}
                      >
                        <option value="zec">.zec</option>
                        <option value="zcash">.zcash</option>
                      </select>
                    </div>
                    {nameError && (
                      <div className="absolute top-full mt-2 text-red-400 text-sm">
                        {nameError}
                      </div>
                    )}
                  </div>
                </div>

                {/* Name Preview */}
                {nameInput && !nameError && (
                  <div className="mb-6 sm:mb-8 p-4 sm:p-6 bg-gold-500/10 border border-gold-500/30 rounded-xl">
                    <div className="flex items-center justify-between mb-3 sm:mb-4">
                      <div>
                        <div className="text-xs sm:text-sm text-gold-400/60 mb-1">Your Name</div>
                        <div className="text-xl sm:text-2xl lg:text-3xl font-bold font-mono break-all">{fullName}</div>
                      </div>
                      <div className="size-12 sm:size-16 bg-gold-500 rounded-full flex items-center justify-center text-black text-lg sm:text-2xl font-bold flex-shrink-0 ml-3">
                        {nameInput[0]?.toUpperCase()}
                      </div>
                    </div>
                    <div className="text-xs sm:text-sm text-gold-400/80">
                      Owner: {wallet?.address.substring(0, 12)}...
                    </div>
                  </div>
                )}

                {/* Cost Breakdown */}
                <div className="mb-6 sm:mb-8">
                  <FeeBreakdown
                    platformFee={nameCost.platformFee}
                    networkFee={nameCost.networkFee}
                    inscriptionOutput={nameCost.inscriptionOutput}
                    total={nameCost.total}
                    zecPrice={zecPrice}
                    priceLoading={priceLoading}
                    priceError={priceError}
                  />
                </div>

                <button
                  onClick={handleNameRegistration}
                  disabled={loading || !isConnected || !nameInput.trim() || !!nameError}
                  className="w-full px-6 sm:px-8 py-4 sm:py-5 bg-gold-500 text-black font-bold text-lg sm:text-xl rounded-xl hover:bg-gold-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-gold-500/20"
                >
                  {loading ? 'Registering...' : `Register ${fullName}`}
                </button>
              </div>
            )}

            {/* TEXT INSCRIPTION TAB */}
            {activeTab === 'text' && (
              <div className="max-w-2xl mx-auto space-y-4 sm:space-y-6">
                <div className="text-center mb-6 sm:mb-8">
                  <h2 className="text-2xl sm:text-3xl font-bold mb-2">Text Inscription</h2>
                  <p className="text-gold-400/60 text-sm sm:text-base">
                    Inscribe any text or data permanently on Zcash
                  </p>
                </div>

                <div>
                  <label className="block text-gold-200/80 text-sm mb-2">Content Type</label>
                  <select
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value)}
                    className="w-full bg-black/40 border border-gold-500/30 rounded-lg px-4 py-3 text-gold-300 outline-none focus:border-gold-500/50"
                    disabled={loading}
                  >
                    <option value="text/plain">Text (text/plain)</option>
                    <option value="application/json">JSON (application/json)</option>
                    <option value="text/html">HTML (text/html)</option>
                    <option value="image/svg+xml">SVG (image/svg+xml)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-gold-200/80 text-sm mb-2">
                    Content {textContent.length > 0 && `(${textContent.length} characters)`}
                  </label>
                  <textarea
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    className="w-full bg-black/40 border border-gold-500/30 rounded-lg px-4 py-3 text-gold-300 font-mono text-sm min-h-[200px] sm:min-h-[300px] outline-none focus:border-gold-500/50"
                    placeholder="Enter your inscription content..."
                    disabled={loading}
                  />
                  <p className="text-gold-400/60 text-xs mt-2">
                    Keep content under 80KB for optimal indexing
                  </p>
                </div>

                <FeeBreakdown
                  platformFee={textCost.platformFee}
                  networkFee={textCost.networkFee}
                  inscriptionOutput={textCost.inscriptionOutput}
                  total={textCost.total}
                  zecPrice={zecPrice}
                  priceLoading={priceLoading}
                  priceError={priceError}
                />

                <button
                  onClick={handleTextInscription}
                  disabled={loading || !isConnected || !textContent.trim()}
                  className="w-full px-6 py-4 bg-gold-500 text-black font-bold text-base sm:text-lg rounded-lg hover:bg-gold-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Creating Inscription...' : 'Inscribe'}
                </button>
              </div>
            )}

            {/* ZRC-20 TAB */}
            {activeTab === 'zrc20' && (
              <div className="max-w-2xl mx-auto space-y-4 sm:space-y-6">
                <div className="text-center mb-6 sm:mb-8">
                  <h2 className="text-2xl sm:text-3xl font-bold mb-2">Mint ZRC-20 Token</h2>
                  <p className="text-gold-400/60 text-sm sm:text-base">
                    Mint tokens from deployed ZRC-20 contracts
                  </p>
                </div>

                <div className="bg-gold-500/10 p-3 sm:p-4 rounded-lg border border-gold-500/30 mb-4 sm:mb-6">
                  <p className="text-gold-300 text-xs sm:text-sm">
                    <strong>Note:</strong> Make sure the token has been deployed first and check the minting limits on{' '}
                    <a
                      href="https://zerdinals.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gold-400 hover:underline"
                    >
                      Zerdinals Explorer
                    </a>
                  </p>
                </div>

                <div>
                  <label className="block text-gold-200/80 text-sm mb-2">Token Ticker</label>
                  <input
                    type="text"
                    value={tick}
                    onChange={(e) => setTick(e.target.value.toUpperCase())}
                    className="w-full bg-black/40 border border-gold-500/30 rounded-lg px-4 py-3 text-gold-300 font-mono uppercase outline-none focus:border-gold-500/50"
                    placeholder="ZERO"
                    maxLength={4}
                    disabled={loading}
                  />
                </div>

                <div>
                  <label className="block text-gold-200/80 text-sm mb-2">Amount</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full bg-black/40 border border-gold-500/30 rounded-lg px-4 py-3 text-gold-300 outline-none focus:border-gold-500/50"
                    placeholder="1000"
                    disabled={loading}
                  />
                </div>

                <div className="bg-black/40 p-3 sm:p-4 rounded-lg border border-gold-500/20">
                  <p className="text-gold-400/60 text-sm mb-2">Preview:</p>
                  <pre className="text-gold-300 text-xs font-mono overflow-x-auto">
                    {JSON.stringify(
                      {
                        p: 'zrc-20',
                        op: 'mint',
                        tick: tick || 'TICK',
                        amt: amount || '0',
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>

                <FeeBreakdown
                  platformFee={zrc20Cost.platformFee}
                  networkFee={zrc20Cost.networkFee}
                  inscriptionOutput={zrc20Cost.inscriptionOutput}
                  total={zrc20Cost.total}
                  zecPrice={zecPrice}
                />

                <button
                  onClick={handleZRC20Mint}
                  disabled={loading || !isConnected || !tick.trim() || !amount.trim()}
                  className="w-full px-6 py-4 bg-gold-500 text-black font-bold text-base sm:text-lg rounded-lg hover:bg-gold-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Minting Token...' : 'Mint ZRC-20'}
                </button>
              </div>
            )}

            {/* Connection Warning */}
            {!isConnected && (
              <div className="w-full m-auto max-w-2xl mt-6 flex justify-center">
                <div className="w-full p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <p className="text-yellow-400 text-sm text-center">
                    ⚠️ Please connect your wallet to continue
                  </p>
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="mt-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* Success Display */}
            {result && (
              <div className="mt-6 p-4 sm:p-6 bg-gold-500/10 border border-gold-500/30 rounded-lg">
                <h3 className="text-gold-300 font-bold mb-4 text-base sm:text-lg">✓ Success!</h3>
                <div className="space-y-3">
                  <div>
                    <div className="text-gold-400/60 text-sm mb-1">Transaction ID</div>
                    <div className="text-gold-300 font-mono text-xs sm:text-sm break-all bg-black/40 p-3 rounded">
                      {result.txid}
                    </div>
                  </div>
                  <div>
                    <div className="text-gold-400/60 text-sm mb-1">Inscription ID</div>
                    <div className="text-gold-300 font-mono text-xs sm:text-sm break-all bg-black/40 p-3 rounded">
                      {result.inscriptionId}
                    </div>
                  </div>
                  <div className="pt-4">
                    <a
                      href={`https://indexer.zerdinals.com/inscription/${result.inscriptionId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block px-4 sm:px-6 py-2 sm:py-3 bg-gold-500 text-black font-bold text-sm sm:text-base rounded-lg hover:bg-gold-400 transition-all"
                    >
                      View on Explorer →
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
