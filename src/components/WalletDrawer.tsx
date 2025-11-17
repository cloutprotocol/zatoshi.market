'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { generateWallet, importFromMnemonic } from '@/lib/wallet';
import { zcashRPC } from '@/services/zcash';
import QRCode from 'qrcode';

interface WalletDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WalletDrawer({ isOpen, onClose }: WalletDrawerProps) {
  const { wallet, connectWallet, disconnectWallet, mounted } = useWallet();
  const [balance, setBalance] = useState({ confirmed: 0, unconfirmed: 0 });
  const [usdPrice, setUsdPrice] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'zrc20' | 'inscriptions'>('zrc20');
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [sendForm, setSendForm] = useState({ to: '', amount: '' });
  const [dragStart, setDragStart] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!wallet?.address) return;
    const bal = await zcashRPC.getBalance(wallet.address);
    setBalance(bal);
  }, [wallet?.address]);

  const fetchPrice = useCallback(async () => {
    const price = await zcashRPC.getPrice();
    setUsdPrice(price);
  }, []);

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

  useEffect(() => {
    if (wallet?.address && isOpen) {
      fetchBalance();
      fetchPrice();
      const interval = setInterval(() => {
        fetchBalance();
        fetchPrice();
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [wallet?.address, isOpen, fetchBalance, fetchPrice]);

  const handleCreateWallet = async () => {
    setLoading(true);
    try {
      const newWallet = await generateWallet();
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
    const mnemonic = prompt('Enter your 12-word mnemonic phrase:');
    if (!mnemonic) return;

    try {
      setLoading(true);
      const imported = await importFromMnemonic(mnemonic.trim());
      connectWallet(imported);
      alert(`Wallet imported! ${imported.address}`);
    } catch (error) {
      alert(`Failed: ${error instanceof Error ? error.message : 'Invalid mnemonic'}`);
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
      alert('Private key copied! Keep it safe.');
      setShowExport(false);
    }
  };

  const handleDisconnect = () => {
    if (confirm('Disconnect wallet?')) {
      disconnectWallet();
      onClose();
    }
  };

  const totalBalance = balance.confirmed + balance.unconfirmed;
  const usdValue = totalBalance * usdPrice;

  // Drag handlers for mobile bottom sheet (handle only)
  const handleDragStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    setDragStart(e.touches[0].clientY);
  };

  const handleDragMove = (e: React.TouchEvent) => {
    if (!isDragging) return;

    const offset = e.touches[0].clientY - dragStart;
    if (offset > 0) {
      e.preventDefault(); // Prevent pull-to-refresh
      setDragOffset(offset);
    }
  };

  const handleDragEnd = () => {
    if (dragOffset > 100) {
      onClose();
    }
    setDragOffset(0);
    setDragStart(0);
    setIsDragging(false);
  };

  // Prevent hydration mismatch and don't show until client is ready
  if (!mounted || !isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/60 z-40 lg:hidden"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed z-50 backdrop-blur-xl bg-black/30 rounded-t-3xl lg:rounded-none
        bottom-0 left-0 right-0 max-h-[80vh] lg:max-h-none
        lg:top-0 lg:right-0 lg:left-auto lg:w-[400px] lg:bottom-0
        transition-transform duration-300 flex flex-col
        ${dragOffset === 0 ? 'translate-y-0' : ''}
      `}
        style={{
          transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : 'translateY(0)',
          touchAction: 'pan-y',
          willChange: isDragging ? 'transform' : 'auto'
        }}
      >
        {/* Drag Handle Area (mobile only) - DRAGGABLE */}
        <div
          className="lg:hidden flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing"
          onTouchStart={handleDragStart}
          onTouchMove={handleDragMove}
          onTouchEnd={handleDragEnd}
          style={{ touchAction: 'none' }}
        >
          <div
            className={`w-12 h-1.5 rounded-full transition-colors ${
              dragOffset > 100 ? 'bg-red-400' : 'bg-gold-500/40'
            }`}
          ></div>
        </div>

        {/* Scrollable Content Area */}
        <div className="p-6 overflow-y-auto flex-1 no-overscroll">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gold-400 hover:text-gold-300 text-2xl z-10"
          >
            ×
          </button>

          {!wallet ? (
            /* No wallet state */
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-gold-300">WALLET</h2>
              <div className="p-4 bg-gold-500/10 border border-gold-500/30 rounded">
                <p className="text-sm text-gold-300">
                  Client-side wallet. Your keys stay in your browser.
                </p>
              </div>
              <div className="space-y-3">
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
              {/* Header */}
              <div className="flex justify-between items-center">
                <h2 className="text-xl text-gold-400 font-bold">WALLET</h2>
              </div>

              {/* Address */}
              <div
                onClick={handleCopyAddress}
                className="p-3 bg-black/40 rounded cursor-pointer hover:bg-black/60 transition-all"
              >
                <p className="text-gold-300 font-mono text-xs break-all">{wallet.address}</p>
              </div>

              {/* Balance */}
              <div className="text-center py-6">
                <div className="text-sm text-gold-200/60 mb-2">BALANCE</div>
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
                  onClick={() => setShowSend(true)}
                  className="px-6 py-3 bg-gold-400 text-black font-bold rounded hover:bg-gold-300 transition-all"
                >
                  Send
                </button>
              </div>

              {/* Tabs */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setActiveTab('zrc20')}
                  className={`px-4 py-3 font-bold rounded transition-all ${
                    activeTab === 'zrc20' ? 'bg-gold-500 text-black' : 'bg-gold-500/10 text-gold-400'
                  }`}
                >
                  ZRC20
                </button>
                <button
                  onClick={() => setActiveTab('inscriptions')}
                  className={`px-4 py-3 font-bold rounded transition-all ${
                    activeTab === 'inscriptions' ? 'bg-gold-500 text-black' : 'bg-gold-500/10 text-gold-400'
                  }`}
                >
                  Inscriptions
                </button>
              </div>

              {/* Tab Content */}
              {activeTab === 'zrc20' && (
                <div className="p-4 bg-black/40 rounded">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gold-500 rounded-full flex items-center justify-center text-black font-bold">
                      Z
                    </div>
                    <div className="flex-1">
                      <div className="text-gold-300 font-bold">ZORE</div>
                      <div className="text-gold-200/60 text-sm">Available: 0</div>
                    </div>
                    <div className="text-gold-400 font-bold">0</div>
                  </div>
                </div>
              )}

              {activeTab === 'inscriptions' && (
                <div className="p-8 text-center text-gold-200/60 text-sm">
                  No inscriptions
                </div>
              )}

              {/* Bottom Actions */}
              <div className="space-y-2">
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
                  Disconnect Wallet
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showMnemonic && wallet && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-6">
          <div className="backdrop-blur-xl bg-black/40 border border-gold-500/30 rounded-lg max-w-2xl w-full p-8">
            <h3 className="text-2xl font-bold text-gold-300 mb-4">BACKUP SEED PHRASE</h3>
            <div className="bg-gold-500/10 border border-gold-500/30 rounded p-4 mb-6">
              <p className="text-sm text-gold-300">
                <strong>IMPORTANT:</strong> Write down these 12 words. This is the only way to recover your wallet.
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
                onClick={handleCopyMnemonic}
                className="px-6 py-3 bg-gold-500/20 text-gold-400 font-bold rounded border border-gold-500/30 hover:bg-gold-500/30 transition-all"
              >
                COPY
              </button>
              <button
                onClick={() => setShowMnemonic(false)}
                className="px-6 py-3 bg-gold-500 text-black font-bold rounded hover:bg-gold-400 transition-all"
              >
                DONE
              </button>
            </div>
          </div>
        </div>
      )}

      {showReceive && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-6">
          <div className="backdrop-blur-xl bg-black/40 border border-gold-500/30 rounded-lg max-w-md w-full p-8 text-center">
            <h3 className="text-2xl font-bold text-gold-300 mb-6">RECEIVE ZEC</h3>
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="Wallet QR" className="mx-auto mb-6 rounded-lg" />
            )}
            <div className="bg-black/40 p-4 rounded mb-6">
              <p className="text-gold-300 font-mono text-sm break-all">{wallet?.address}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={handleCopyAddress}
                className="px-6 py-3 bg-gold-500 text-black font-bold rounded hover:bg-gold-400 transition-all"
              >
                COPY
              </button>
              <button
                onClick={() => setShowReceive(false)}
                className="px-6 py-3 bg-gold-500/20 text-gold-400 font-bold rounded border border-gold-500/30 hover:bg-gold-500/30 transition-all"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}

      {showSend && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-6">
          <div className="backdrop-blur-xl bg-black/40 border border-gold-500/30 rounded-lg max-w-md w-full p-8">
            <h3 className="text-2xl font-bold text-gold-300 mb-6">SEND ZEC</h3>
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-4 mb-6">
              <p className="text-sm text-yellow-400">
                Transaction broadcasting requires RPC endpoint. View-only for now.
              </p>
            </div>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-gold-200/80 text-sm mb-2">To Address</label>
                <input
                  type="text"
                  value={sendForm.to}
                  onChange={(e) => setSendForm({ ...sendForm, to: e.target.value })}
                  className="w-full bg-black/40 border border-gold-500/30 rounded px-4 py-3 text-gold-300 font-mono text-sm"
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
                  className="w-full bg-black/40 border border-gold-500/30 rounded px-4 py-3 text-gold-300"
                  placeholder="0.0000"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button
                disabled
                className="px-6 py-3 bg-gold-500/50 text-black font-bold rounded cursor-not-allowed opacity-50"
              >
                SEND
              </button>
              <button
                onClick={() => setShowSend(false)}
                className="px-6 py-3 bg-gold-500/20 text-gold-400 font-bold rounded border border-gold-500/30 hover:bg-gold-500/30 transition-all"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {showExport && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-6">
          <div className="backdrop-blur-xl bg-black/40 border border-gold-500/30 rounded-lg max-w-md w-full p-8">
            <h3 className="text-2xl font-bold text-gold-300 mb-4">EXPORT PRIVATE KEY</h3>
            <div className="bg-gold-500/10 border border-gold-500/30 rounded p-4 mb-6">
              <p className="text-sm text-gold-300 mb-2">
                <strong>SECURITY NOTICE:</strong> Your private key provides full access.
              </p>
              <ul className="text-xs text-gold-300 space-y-1 list-disc list-inside">
                <li>Keep it secure and private</li>
                <li>Store offline in safe location</li>
                <li>Be aware of screen recording</li>
              </ul>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={confirmExport}
                className="px-6 py-3 bg-gold-500 text-black font-bold rounded hover:bg-gold-400 transition-all"
              >
                EXPORT
              </button>
              <button
                onClick={() => setShowExport(false)}
                className="px-6 py-3 bg-gold-500/20 text-gold-400 font-bold rounded border border-gold-500/30 hover:bg-gold-500/30 transition-all"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
