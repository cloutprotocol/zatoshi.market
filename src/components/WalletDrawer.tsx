'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { generateWallet, importFromMnemonic, importFromPrivateKey } from '@/lib/wallet';
import { zcashRPC } from '@/services/zcash';
import { sendZEC } from '@/services/transaction';
import QRCode from 'qrcode';
import { calculateZRC20Balances, formatZRC20Amount, type ZRC20Token } from '@/utils/zrc20';

interface WalletDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  desktopExpanded: boolean;
  setDesktopExpanded: (expanded: boolean) => void;
}

export default function WalletDrawer({ isOpen, onClose, desktopExpanded, setDesktopExpanded }: WalletDrawerProps) {
  const { wallet, connectWallet, disconnectWallet, mounted, hasStoredKeystore, unlockWallet, saveEncrypted, lockWallet } = useWallet();
  const [balance, setBalance] = useState({ confirmed: 0, unconfirmed: 0 });
  const [usdPrice, setUsdPrice] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showMnemonicExport, setShowMnemonicExport] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [sendForm, setSendForm] = useState({ to: '', amount: '' });
  const [sendingTx, setSendingTx] = useState(false);
  const [inscriptions, setInscriptions] = useState<any[]>([]);
  const [loadingInscriptions, setLoadingInscriptions] = useState(false);
  const [inscriptionContents, setInscriptionContents] = useState<Record<string, string>>({});
  const [zrc20Tokens, setZrc20Tokens] = useState<ZRC20Token[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasFetchedFresh, setHasFetchedFresh] = useState(false);

  const fetchBalance = useCallback(async (forceRefresh: boolean = false) => {
    if (!wallet?.address) return;
    console.log('📊 Fetching balance for:', wallet.address, forceRefresh ? '(force refresh)' : '(cached ok)');
    const bal = await zcashRPC.getBalance(wallet.address, forceRefresh);
    console.log('📊 Balance:', bal);
    setBalance(bal);
  }, [wallet?.address]);

  const fetchPrice = useCallback(async () => {
    const price = await zcashRPC.getPrice();
    setUsdPrice(price);
  }, []);

  const fetchInscriptions = useCallback(async (forceRefresh: boolean = false) => {
    if (!wallet?.address) return;
    setLoadingInscriptions(true);
    console.log('🎨 Fetching inscriptions for:', wallet.address, forceRefresh ? '(force refresh)' : '(cached ok)');
    try {
      const data = await zcashRPC.getInscriptions(wallet.address, forceRefresh);
      const inscriptionList = data.inscriptions || [];
      console.log(`🎨 Found ${inscriptionList.length} inscriptions`);
      setInscriptions(inscriptionList);

      // Fetch content for each inscription (limit to first 20 to avoid too many requests)
      const contentsToFetch = inscriptionList.slice(0, 20);
      const contents: Record<string, string> = {};

      await Promise.all(
        contentsToFetch.map(async (insc) => {
          try {
            const response = await fetch(`/api/zcash/inscription-content/${insc.id}`);
            if (response.ok) {
              contents[insc.id] = await response.text();
            }
          } catch (err) {
            console.error(`Failed to fetch content for ${insc.id}:`, err);
          }
        })
      );

      setInscriptionContents(contents);

      // Calculate ZRC-20 balances from inscriptions
      const tokens = calculateZRC20Balances(inscriptionList, contents);
      setZrc20Tokens(tokens);
      console.log(`💰 Found ${tokens.length} ZRC-20 tokens`);
    } catch (error) {
      console.error('Failed to fetch inscriptions:', error);
      setInscriptions([]);
      setZrc20Tokens([]);
    } finally {
      setLoadingInscriptions(false);
    }
  }, [wallet?.address]);

  const handleRefresh = async () => {
    if (isRefreshing || !wallet?.address) return;
    setIsRefreshing(true);
    try {
      await Promise.all([
        fetchBalance(true), // Force refresh to bypass cache
        fetchPrice(),
        fetchInscriptions(true) // Force refresh to bypass cache
      ]);
    } finally {
      setTimeout(() => setIsRefreshing(false), 1000);
    }
  };

  // Lock body scroll when drawer is open (mobile only)
  useEffect(() => {
    if (isOpen && typeof window !== 'undefined') {
      const isMobile = window.innerWidth < 1024;
      if (isMobile) {
        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.width = '100%';
        document.body.style.touchAction = 'none';
      }
      return () => {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.body.style.touchAction = '';
      };
    }
  }, [isOpen]);

  // Load balance, price, and inscriptions when drawer opens
  // First time: force refresh to bypass Blockchair cache
  // Subsequent times: use server cache to minimize API calls
  useEffect(() => {
    if (wallet?.address && isOpen) {
      if (!hasFetchedFresh) {
        // First load: bypass caches to get fresh data
        fetchBalance(true);
        fetchInscriptions(true);
        setHasFetchedFresh(true);
      } else {
        // Subsequent loads: use cached data
        fetchBalance();
        fetchInscriptions();
      }
      fetchPrice();
    }
  }, [wallet?.address, isOpen, hasFetchedFresh, fetchBalance, fetchPrice, fetchInscriptions]);

  const handleCreateWallet = async () => {
    setLoading(true);
    try {
      const newWallet = await generateWallet();
      // Require password to encrypt keystore
      const password = prompt('Set a password to encrypt your wallet (required):');
      if (!password || password.length < 8) {
        alert('Password required (min 8 chars). Wallet not saved.');
        return;
      }
      await saveEncrypted(newWallet, password);
      connectWallet(newWallet);
      setShowMnemonic(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Failed to generate wallet: ${msg}`);
      console.error('Wallet generation error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleImportWallet = async () => {
    const input = prompt('Enter your private key:');
    if (!input) return;
    const value = input.trim();
    try {
      setLoading(true);
      console.log('🔑 Attempting private key import...');
      const imported = await importFromPrivateKey(value);
      console.log('✅ Private key import successful:', imported.address);

      const password = prompt('Set a password to encrypt your wallet (required):');
      if (!password || password.length < 8) {
        alert('Password required (min 8 chars). Wallet not saved.');
        return;
      }

      await saveEncrypted(imported as any, password);
      connectWallet(imported as any);
      alert(`Wallet imported successfully! Address: ${imported.address}`);
    } catch (error) {
      console.error('❌ Import error:', error);
      alert('Invalid private key. Please enter a valid Zcash private key (starts with L or K).');
    } finally {
      setLoading(false);
    }
  };

  const handleUnlock = async () => {
    const password = prompt('Enter your wallet password:');
    if (!password) return;
    setLoading(true);
    try {
      const ok = await unlockWallet(password);
      if (!ok) alert('Incorrect password');
    } finally {
      setLoading(false);
    }
  };

  const handleShowReceive = async () => {
    if (wallet?.address) {
      const qr = await QRCode.toDataURL(wallet.address, {
        width: 256,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' }
      });
      setQrDataUrl(qr);
      setShowReceive(true);
    }
  };

  const handleCopyAddress = () => {
    if (wallet?.address) {
      navigator.clipboard.writeText(wallet.address);
      alert('Address copied!');
    }
  };

  const handleCopyMnemonic = () => {
    if (wallet?.mnemonic) {
      navigator.clipboard.writeText(wallet.mnemonic);
      alert('Mnemonic copied!');
    }
  };

  const handleExport = () => setShowExport(true);

  const confirmExport = () => {
    if (wallet?.privateKey) {
      navigator.clipboard.writeText(wallet.privateKey);
      alert('Private key (WIF) copied to clipboard! Keep it safe.');
      setShowExport(false);
    }
  };

  const handleDisconnect = () => {
    if (confirm('Disconnect wallet?')) {
      disconnectWallet();
      onClose();
    }
  };

  const handleSend = async () => {
    if (!wallet?.address || !wallet.privateKey) {
      alert('Wallet not available');
      return;
    }

    const toAddress = sendForm.to.trim();
    const amount = parseFloat(sendForm.amount);

    // Validation
    if (!toAddress || !toAddress.startsWith('t1')) {
      alert('Invalid recipient address. Must be a Zcash t-address (starts with t1)');
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      alert('Invalid amount. Must be greater than 0');
      return;
    }

    if (amount > totalBalance) {
      alert(`Insufficient balance. You have ${totalBalance.toFixed(4)} ZEC`);
      return;
    }

    // Confirm send
    const confirmed = confirm(
      `Send ${amount} ZEC to:\n${toAddress}\n\nThis action cannot be undone. Continue?`
    );
    if (!confirmed) return;

    setSendingTx(true);
    try {
      const result = await sendZEC(wallet.address, toAddress, amount, wallet.privateKey);
      alert(
        `✅ Transaction sent!\n\nTXID: ${result.txid}\n\nAmount: ${result.sentAmount} ZEC\nFee: ${result.fee} ZEC\n\nView on explorer: https://zerdinals.com/tx/${result.txid}`
      );
      setSendForm({ to: '', amount: '' });
      setShowSend(false);
      // Refresh balance
      fetchBalance();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      alert(`❌ Transaction failed:\n${msg}`);
      console.error('Send transaction error:', error);
    } finally {
      setSendingTx(false);
    }
  };

  const totalBalance = balance.confirmed + balance.unconfirmed;
  const usdValue = totalBalance * usdPrice;

  // Prevent hydration mismatch and don't show until client is ready
  if (!mounted || !isOpen) return null;

  return (
    <>
      {/* Overlay - mobile only */}
      <div
        className="fixed inset-0 top-16 bg-black/60 z-40 lg:hidden"
        onClick={onClose}
      />

      {/* Desktop Toggle Button - always visible */}
      <button
        onClick={() => setDesktopExpanded(!desktopExpanded)}
        className={`hidden lg:flex fixed top-1/2 -translate-y-1/2 z-40
          w-8 h-16 bg-black/30 backdrop-blur-xl border border-gold-500/20
          items-center justify-center text-gold-400 hover:text-gold-300 hover:bg-black/50 transition-all duration-300
          ${desktopExpanded ? 'right-[400px]' : 'right-0'}
        `}
      >
        {desktopExpanded ? '→' : '←'}
      </button>

      {/* Drawer */}
      <div
        className={`fixed backdrop-blur-xl bg-black/30
        top-16 bottom-0 left-0 right-0
        z-50 lg:z-40
        lg:right-0 lg:left-auto lg:w-[400px]
        transition-all duration-300 flex flex-col
        lg:border-l lg:border-gold-500/20
        ${!desktopExpanded ? 'lg:translate-x-full' : 'lg:translate-x-0'}
      `}
      >

        {/* Scrollable Content Area */}
        <div className="px-6 pt-3 pb-6 overflow-y-auto flex-1 no-overscroll">
          {!wallet ? (
            /* No wallet state */
            <div className="space-y-6">
              {/* Header with close button */}
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gold-300">WALLET</h2>
                <button
                  onClick={onClose}
                  className="text-gold-400 hover:text-gold-300 text-2xl"
                >
                  ×
                </button>
              </div>
              <div className="p-4 bg-gold-500/10 border border-gold-500/30 rounded">
                <p className="text-sm text-gold-300">
                  Client-side wallet. Your keys stay in your browser. Encrypted at rest with your password.
                </p>
              </div>
              <div className="space-y-3">
                {hasStoredKeystore && (
                  <button
                    onClick={handleUnlock}
                    disabled={loading}
                    className="w-full px-6 py-3 bg-gold-500 text-black font-bold rounded hover:bg-gold-400 transition-all disabled:opacity-50"
                  >
                    {loading ? 'UNLOCKING...' : 'UNLOCK WALLET'}
                  </button>
                )}
                <button
                  onClick={handleCreateWallet}
                  disabled={loading}
                  className="w-full px-6 py-3 bg-gold-500 text-black font-bold rounded hover:bg-gold-400 transition-all disabled:opacity-50"
                >
                  {loading ? 'GENERATING...' : 'CREATE WALLET'}
                </button>
                <button
                  onClick={handleImportWallet}
                  className="w-full px-6 py-3 bg-gold-500/10 text-gold-400 font-bold rounded border border-gold-500/30 hover:bg-gold-500/20 transition-all"
                >
                  IMPORT WALLET
                </button>
              </div>
            </div>
          ) : (
            /* Wallet connected state */
            <div className="space-y-6">
              {/* Header with Close */}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl text-gold-400 font-bold">WALLET</h2>
                  <button
                    onClick={handleCopyAddress}
                    className="p-1.5 hover:bg-gold-500/20 rounded transition-all"
                    title="Copy address"
                  >
                    <svg className="w-4 h-4 text-gold-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
                <button
                  onClick={onClose}
                  className="text-gold-400 hover:text-gold-300 text-1xl mr-3"
                >

                </button>
              </div>

              {/* Balance */}
              <div className="text-center py-6">
                <div className="flex items-center justify-center gap-2 text-sm text-gold-200/60 mb-2">
                  <span>BALANCE</span>
                  <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className={`p-1 hover:bg-gold-500/20 rounded transition-all ${isRefreshing ? 'animate-spin' : ''}`}
                    title="Refresh balance"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
                <div className="text-4xl font-bold mb-2">
                  <span className="text-white">{totalBalance.toFixed(4)}</span>
                  <span className="text-gold-400 ml-2">ZEC</span>
                </div>
                <div className="text-lg text-gold-200/60">${usdValue.toFixed(2)}</div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleShowReceive}
                  className="px-6 py-3 border-2 border-gold-500 text-gold-400 font-bold rounded hover:bg-gold-500/10 transition-all"
                >
                  Receive
                </button>
                <button
                  disabled
                  className="px-6 py-3 bg-gold-400/30 text-black/50 font-bold rounded cursor-not-allowed opacity-50"
                  title="Send feature temporarily disabled"
                >
                  Send
                </button>
              </div>

              {/* Inscriptions Section */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-gold-400 uppercase tracking-wide">Inscriptions</h3>
                  <div className="group relative">
                    <div className="w-4 h-4 rounded-full border border-gold-500/50 flex items-center justify-center text-gold-500/70 text-xs cursor-help">
                      i
                    </div>
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-48 p-2 bg-black/90 border border-gold-500/30 rounded text-xs text-gold-300 text-center z-10">
                      Some inscriptions may not be shown
                    </div>
                  </div>
                </div>
                <div>
                  {loadingInscriptions ? (
                    <div className="grid grid-cols-3 lg:grid-cols-2 gap-2">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="bg-black/40 border border-gold-500/20 rounded p-2">
                          <div className="bg-gold-500/10 rounded p-2 mb-1.5 h-[60px] animate-pulse"></div>
                          <div className="flex items-center justify-between">
                            <div className="w-12 h-3 bg-gold-500/10 rounded animate-pulse"></div>
                            <div className="w-8 h-4 bg-gold-500/10 rounded animate-pulse"></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : inscriptions.length === 0 ? (
                    <div className="p-8 text-center text-gold-200/60 text-sm">
                      No inscriptions
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="grid grid-cols-3 lg:grid-cols-2 gap-2 max-h-[200px] lg:max-h-[300px] overflow-y-auto">
                        {inscriptions.map((insc) => {
                        // Get content from fetched data
                        const content = inscriptionContents[insc.id] || '';
                        let contentPreview = '';
                        let isJSON = false;

                        if (content) {
                          if (insc.contentType === 'application/json' || insc.contentType?.includes('json')) {
                            isJSON = true;
                            try {
                              const parsed = JSON.parse(content);
                              contentPreview = JSON.stringify(parsed, null, 2);
                            } catch {
                              contentPreview = content;
                            }
                          } else if (insc.contentType?.includes('text')) {
                            contentPreview = content;
                          } else {
                            contentPreview = content;
                          }
                        } else {
                          contentPreview = 'Loading...';
                        }

                        return (
                          <div
                            key={insc.id}
                            className="bg-black/40 border border-gold-500/20 rounded p-2 hover:border-gold-500/40 transition-all cursor-pointer"
                            onClick={() => window.open(`https://zerdinals.com/zerdinals/${insc.inscriptionNumber}`, '_blank')}
                          >
                            {/* Content Preview */}
                            <div className="bg-black/60 rounded p-2 mb-1.5 h-[60px] overflow-hidden">
                              <pre className="text-gold-300 text-[10px] font-mono whitespace-pre-wrap break-all line-clamp-3">
                                {contentPreview}
                              </pre>
                            </div>

                            {/* Footer */}
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-gold-400/60">
                                #{insc.inscriptionNumber || '?'}
                              </span>
                              <div className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                isJSON
                                  ? 'bg-blue-500/20 text-blue-300'
                                  : 'bg-gold-500/20 text-gold-300'
                              }`}>
                                {isJSON ? 'JSON' : 'TXT'}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      </div>
                      {/* Gradient hint for more content */}
                      {inscriptions.length > 6 && (
                        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none"></div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom Actions */}
              <div className="space-y-2">
                <button
                  onClick={lockWallet}
                  className="w-full px-6 py-2 bg-gold-500/10 text-gold-400 text-sm border border-gold-500/30 rounded hover:bg-gold-500/20 transition-all"
                >
                  Lock Wallet
                </button>
                <button
                  onClick={handleExport}
                  className="w-full px-6 py-2 bg-gold-500/10 text-gold-400 text-sm border border-gold-500/30 rounded hover:bg-gold-500/20 transition-all"
                >
                  Export Private Key
                </button>
                <button
                  onClick={handleDisconnect}
                  className="w-full px-6 py-2 text-gold-400/60 text-sm hover:text-gold-400 transition-all"
                >
                  Disconnect (Forget) Wallet
                </button>
              </div>

              {/* Address - Desktop only at bottom */}
              <div
                onClick={handleCopyAddress}
                className="hidden lg:block p-3 bg-black/40 rounded cursor-pointer hover:bg-black/60 transition-all"
              >
                <p className="text-white font-mono text-xs break-all text-center">{wallet.address}</p>
              </div>

              {/* Address & Close - Mobile only at bottom */}
              <div className="lg:hidden space-y-3 mt-6 pt-6 border-t border-gold-500/20">
                <div
                  onClick={handleCopyAddress}
                  className="p-3 bg-black/40 rounded cursor-pointer hover:bg-black/60 transition-all"
                >
                  <p className="text-white font-mono text-xs text-center break-all">{wallet.address}</p>
                </div>
                <button
                  onClick={onClose}
                  className="w-full py-3 bg-black/60 backdrop-blur-sm text-gold-400 text-xl font-bold rounded hover:bg-black/80 transition-all"
                >
                  \/
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showMnemonic && wallet && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-6 overflow-y-auto">
          <div className="backdrop-blur-xl bg-black/40 border border-gold-500/30 rounded max-w-3xl w-full p-8 my-8">
            <h3 className="text-2xl font-bold text-gold-300 mb-4">WALLET CREATED - BACKUP NOW</h3>
            <div className="bg-gold-500/10 border border-gold-500/30 rounded p-4 mb-6">
              <p className="text-sm text-gold-300">
                <strong>CRITICAL:</strong> Save both your private key and 12-word phrase. Store them securely offline. You need these to recover your wallet.
              </p>
            </div>

            {/* Private Key Section */}
            <div className="mb-6">
              <h4 className="text-lg font-bold text-gold-300 mb-3">Private Key (WIF)</h4>
              <div className="bg-black/40 p-4 rounded mb-2 break-all">
                <p className="text-gold-300 font-mono text-sm">{wallet.privateKey}</p>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(wallet.privateKey);
                  alert('Private key copied to clipboard!');
                }}
                className="w-full px-4 py-2 bg-gold-500/10 text-gold-400 text-sm border border-gold-500/30 rounded hover:bg-gold-500/20 transition-all"
              >
                Copy Private Key
              </button>
            </div>

            {/* 12-Word Phrase Section */}
            <div className="mb-6">
              <h4 className="text-lg font-bold text-gold-300 mb-3">12-Word Recovery Phrase</h4>
              <div className="grid grid-cols-3 gap-3 mb-2">
                {wallet.mnemonic.split(' ').map((word, i) => (
                  <div key={i} className="bg-black/40 p-3 rounded text-center">
                    <span className="text-gold-200/60 text-xs">{i + 1}. </span>
                    <span className="text-gold-300 font-mono text-sm">{word}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={handleCopyMnemonic}
                className="w-full px-4 py-2 bg-gold-500/10 text-gold-400 text-sm border border-gold-500/30 rounded hover:bg-gold-500/20 transition-all"
              >
                Copy 12-Word Phrase
              </button>
            </div>

            <button
              onClick={() => setShowMnemonic(false)}
              className="w-full px-6 py-3 bg-gold-500 text-black font-bold rounded hover:bg-gold-400 transition-all"
            >
              I HAVE SAVED MY BACKUP
            </button>
          </div>
        </div>
      )}

      {showReceive && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-6">
          <div className="backdrop-blur-xl bg-black/30 border border-gold-500/20 rounded max-w-md w-full p-6 text-center">
            <h3 className="text-xl font-bold text-gold-400 mb-6 uppercase tracking-wide">RECEIVE ZEC</h3>
            {qrDataUrl && (
              <div className="bg-white p-4 rounded mb-6 inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="Wallet QR" className="w-64 h-64" />
              </div>
            )}
            <div className="bg-black/40 p-3 rounded mb-6">
              <p className="text-white font-mono text-xs break-all">{wallet?.address}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleCopyAddress}
                className="px-6 py-3 bg-gold-500 text-black font-bold rounded hover:bg-gold-400 transition-colors"
              >
                COPY
              </button>
              <button
                onClick={() => setShowReceive(false)}
                className="px-6 py-3 bg-black/60 backdrop-blur-sm text-gold-400 font-bold rounded hover:bg-black/80 transition-colors"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}

      {showSend && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-6">
          <div className="backdrop-blur-xl bg-black/40 border border-gold-500/30 rounded max-w-md w-full p-8">
            <h3 className="text-2xl font-bold text-gold-300 mb-6">SEND ZEC</h3>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-gold-200/80 text-sm mb-2">To Address</label>
                <input
                  type="text"
                  value={sendForm.to}
                  onChange={(e) => setSendForm({ ...sendForm, to: e.target.value })}
                  disabled={sendingTx}
                  className="w-full bg-black/40 border border-gold-500/30 rounded px-4 py-3 text-gold-300 font-mono text-sm disabled:opacity-50"
                  placeholder="t1..."
                />
              </div>
              <div>
                <label className="block text-gold-200/80 text-sm mb-2">Amount (ZEC)</label>
                <input
                  type="number"
                  step="0.0001"
                  value={sendForm.amount}
                  onChange={(e) => setSendForm({ ...sendForm, amount: e.target.value })}
                  disabled={sendingTx}
                  className="w-full bg-black/40 border border-gold-500/30 rounded px-4 py-3 text-gold-300 disabled:opacity-50"
                  placeholder="0.0000"
                />
              </div>
              <div className="text-sm text-gold-200/60">
                Available: {totalBalance.toFixed(4)} ZEC
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={handleSend}
                disabled={sendingTx || !sendForm.to || !sendForm.amount}
                className="px-6 py-3 bg-gold-500 text-black font-bold rounded hover:bg-gold-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sendingTx ? 'SENDING...' : 'SEND'}
              </button>
              <button
                onClick={() => setShowSend(false)}
                disabled={sendingTx}
                className="px-6 py-3 bg-gold-500/20 text-gold-400 font-bold rounded border border-gold-500/30 hover:bg-gold-500/30 transition-all disabled:opacity-50"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Choice Modal */}
      {showExport && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-6">
          <div className="backdrop-blur-xl bg-black/40 border border-gold-500/30 rounded max-w-md w-full p-8">
            <h3 className="text-2xl font-bold text-gold-300 mb-4">EXPORT OPTIONS</h3>
            <div className="bg-gold-500/10 border border-gold-500/30 rounded p-4 mb-6">
              <p className="text-sm text-gold-300">
                Choose which format to export your wallet credentials. Both provide full access to your wallet.
              </p>
            </div>
            <div className="space-y-3 mb-6">
              <button
                onClick={() => {
                  const password = prompt('Enter your wallet password to view private key:');
                  if (password) {
                    setShowExport(false);
                    setShowPrivateKey(true);
                  }
                }}
                className="w-full px-6 py-4 bg-gold-500/10 text-gold-300 border border-gold-500/30 rounded hover:bg-gold-500/20 transition-all text-left"
              >
                <div className="font-bold mb-1">WIF Private Key</div>
                <div className="text-xs text-gold-300/60">Single-line format (starts with L or K)</div>
              </button>
              <button
                onClick={() => {
                  if (!wallet?.mnemonic) {
                    alert('No recovery phrase available for this wallet (imported via private key)');
                    return;
                  }
                  const password = prompt('Enter your wallet password to view 12-word phrase:');
                  if (password) {
                    setShowExport(false);
                    setShowMnemonicExport(true);
                  }
                }}
                className="w-full px-6 py-4 bg-gold-500/10 text-gold-300 border border-gold-500/30 rounded hover:bg-gold-500/20 transition-all text-left"
              >
                <div className="font-bold mb-1">12-Word Recovery Phrase</div>
                <div className="text-xs text-gold-300/60">BIP39 mnemonic (if available)</div>
              </button>
            </div>
            <button
              onClick={() => setShowExport(false)}
              className="w-full px-6 py-3 bg-gold-500/20 text-gold-400 font-bold rounded border border-gold-500/30 hover:bg-gold-500/30 transition-all"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* Private Key Modal */}
      {showPrivateKey && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-6">
          <div className="backdrop-blur-xl bg-black/40 border border-gold-500/30 rounded max-w-md w-full p-8">
            <h3 className="text-2xl font-bold text-gold-300 mb-4">PRIVATE KEY (WIF)</h3>
            <div className="bg-gold-500/10 border border-gold-500/30 rounded p-4 mb-4">
              <p className="text-sm text-gold-300 mb-2">
                <strong>SECURITY NOTICE:</strong> Anyone with this key has full access to your wallet.
              </p>
              <ul className="text-xs text-gold-300 space-y-1 list-disc list-inside">
                <li>Keep it secure and private</li>
                <li>Store offline in safe location</li>
                <li>Be aware of screen recording</li>
              </ul>
            </div>
            <div className="bg-black/40 p-4 rounded mb-6 break-all">
              <p className="text-gold-300 font-mono text-sm">{wallet?.privateKey}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => {
                  if (wallet?.privateKey) {
                    navigator.clipboard.writeText(wallet.privateKey);
                    alert('Private key (WIF) copied to clipboard!');
                  }
                }}
                className="px-6 py-3 bg-gold-500 text-black font-bold rounded hover:bg-gold-400 transition-all"
              >
                COPY
              </button>
              <button
                onClick={() => setShowPrivateKey(false)}
                className="px-6 py-3 bg-gold-500/20 text-gold-400 font-bold rounded border border-gold-500/30 hover:bg-gold-500/30 transition-all"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mnemonic Export Modal */}
      {showMnemonicExport && wallet && wallet.mnemonic && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-6">
          <div className="backdrop-blur-xl bg-black/40 border border-gold-500/30 rounded max-w-2xl w-full p-8">
            <h3 className="text-2xl font-bold text-gold-300 mb-4">12-WORD RECOVERY PHRASE</h3>
            <div className="bg-gold-500/10 border border-gold-500/30 rounded p-4 mb-6">
              <p className="text-sm text-gold-300">
                <strong>BACKUP:</strong> Write down these 12 words in order. This is the only way to recover your wallet if you lose your password.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-6">
              {wallet.mnemonic.split(' ').map((word, i) => (
                <div key={i} className="bg-black/40 p-3 rounded text-center">
                  <span className="text-gold-200/60 text-xs">{i + 1}. </span>
                  <span className="text-gold-300 font-mono">{word}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => {
                  if (wallet.mnemonic) {
                    navigator.clipboard.writeText(wallet.mnemonic);
                    alert('12-word phrase copied to clipboard!');
                  }
                }}
                className="px-6 py-3 bg-gold-500 text-black font-bold rounded hover:bg-gold-400 transition-all"
              >
                COPY
              </button>
              <button
                onClick={() => setShowMnemonicExport(false)}
                className="px-6 py-3 bg-gold-500/20 text-gold-400 font-bold rounded border border-gold-500/30 hover:bg-gold-500/30 transition-all"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
