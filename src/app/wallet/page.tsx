'use client';

import { useEffect, useState, useCallback } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { generateWallet, importFromMnemonic, importFromPrivateKey } from '@/lib/wallet';
import { zcashRPC } from '@/services/zcash';
import { sendZEC } from '@/services/transaction';
import QRCode from 'qrcode';

export default function WalletPage() {
  const { wallet, connectWallet, disconnectWallet, hasStoredKeystore, unlockWallet, saveEncrypted, lockWallet } = useWallet();
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
  const [isSending, setIsSending] = useState(false);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!wallet?.address) return;
    const bal = await zcashRPC.getBalance(wallet.address);
    setBalance(bal);
  }, [wallet?.address]);

  const fetchPrice = useCallback(async () => {
    const price = await zcashRPC.getPrice();
    setUsdPrice(price);
  }, []);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return; // Prevent multiple simultaneous refreshes
    setIsRefreshing(true);
    try {
      await Promise.all([fetchBalance(), fetchPrice()]);
    } finally {
      setTimeout(() => setIsRefreshing(false), 2000); // 2 second cooldown
    }
  }, [isRefreshing, fetchBalance, fetchPrice]);

  // Load balance and price only once on mount
  useEffect(() => {
    if (wallet?.address) {
      fetchBalance();
      fetchPrice();
    }
  }, [wallet?.address, fetchBalance, fetchPrice]);

  const handleCreateWallet = async () => {
    setLoading(true);
    try {
      const newWallet = await generateWallet();
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
      alert('Address copied to clipboard!');
    }
  };

  const handleCopyMnemonic = () => {
    if (wallet?.mnemonic) {
      navigator.clipboard.writeText(wallet.mnemonic);
      alert('Mnemonic copied to clipboard!');
    }
  };

  const handleExport = () => {
    setShowExport(true);
  };

  const confirmExport = () => {
    if (wallet?.privateKey) {
      navigator.clipboard.writeText(wallet.privateKey);
      alert('Private key copied to clipboard! Keep it safe and never share it.');
      setShowExport(false);
    }
  };

  const handleSend = async () => {
    if (!wallet?.address || !wallet?.privateKey) {
      alert('Wallet not available');
      return;
    }

    // Validate inputs
    if (!sendForm.to || !sendForm.amount) {
      alert('Please enter recipient address and amount');
      return;
    }

    const amount = parseFloat(sendForm.amount);
    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    if (amount > totalBalance) {
      alert(`Insufficient balance. You have ${totalBalance.toFixed(8)} ZEC`);
      return;
    }

    // Confirm transaction
    const confirmed = confirm(
      `Send ${amount} ZEC to ${sendForm.to}?\n\n` +
      `This action cannot be undone.`
    );

    if (!confirmed) return;

    setIsSending(true);

    try {
      const result = await sendZEC(
        wallet.address,
        sendForm.to,
        amount,
        wallet.privateKey
      );

      alert(
        `✅ Transaction sent successfully!\n\n` +
        `TXID: ${result.txid}\n` +
        `Amount: ${result.sentAmount} ZEC\n` +
        `Fee: ${result.fee} ZEC\n\n` +
        `View on explorer: https://blockchair.com/zcash/transaction/${result.txid}`
      );

      // Reset form and close modal
      setSendForm({ to: '', amount: '' });
      setShowSend(false);

      // Refresh balance after a short delay
      setTimeout(() => {
        fetchBalance();
      }, 2000);

    } catch (error) {
      console.error('Send error:', error);
      alert(
        `❌ Failed to send transaction:\n\n${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setIsSending(false);
    }
  };

  const totalBalance = balance.confirmed + balance.unconfirmed;
  const usdValue = totalBalance * usdPrice;

  if (!wallet) {
    return (
      <main className="relative min-h-screen bg-black">
        <div className="fixed inset-0 bg-gradient-to-br from-black via-gray-900 to-black" />

        <div className="relative z-10 container mx-auto px-6 py-24">
          <div className="max-w-2xl mx-auto">
            <div className="glass-card p-12 text-center">
              <h1 className="text-4xl font-bold mb-6 text-gold-300">
                ZCASH WALLET
              </h1>
              <p className="text-gold-100/80 mb-8">
                Create a new wallet or import an existing one to manage your ZEC, ZRC20 tokens, and Zerdinal inscriptions.
              </p>

              {/* Security Notice */}
              <div className="mb-8 p-4 bg-gold-500/10 border border-gold-500/30 rounded">
                <p className="text-sm text-gold-300">
                  This is a client-side wallet. Your keys are generated in your browser and we never have access to them. For significant holdings, consider using a hardware wallet.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                {hasStoredKeystore && (
                  <button
                    onClick={handleUnlock}
                    disabled={loading}
                    className="px-8 py-4 bg-gold-500 text-black font-bold rounded-lg hover:bg-gold-400 transition-all disabled:opacity-50"
                  >
                    {loading ? 'UNLOCKING...' : 'UNLOCK WALLET'}
                  </button>
                )}
                <button
                  onClick={handleCreateWallet}
                  disabled={loading}
                  className="px-8 py-4 bg-gold-500 text-black font-bold rounded-lg hover:bg-gold-400 transition-all disabled:opacity-50"
                >
                  {loading ? 'GENERATING...' : 'CREATE NEW WALLET'}
                </button>
                <button
                  onClick={handleImportWallet}
                  className="px-8 py-4 bg-gold-500/10 text-gold-400 font-bold rounded-lg border border-gold-500/30 hover:bg-gold-500/20 transition-all"
                >
                  IMPORT WALLET
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen bg-black">
      <div className="fixed inset-0 bg-gradient-to-br from-black via-gray-900 to-black" />

      <div className="relative z-10 container mx-auto px-6 py-12">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="glass-card p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl text-gold-400 font-bold">WALLET</h2>
              <div className="flex gap-4">
                <button
                  onClick={lockWallet}
                  className="px-4 py-2 text-gold-400 text-sm hover:text-gold-300"
                  title="Lock wallet (requires password to unlock again)"
                >
                  Lock Wallet
                </button>
                <button
                  onClick={handleExport}
                  className="px-4 py-2 text-gold-400 text-sm hover:text-gold-300"
                >
                  Export Private Key
                </button>
                <button
                  onClick={handleCopyAddress}
                  className="px-4 py-2 text-gold-400 text-sm hover:text-gold-300 font-mono"
                >
                  {wallet.address.slice(0, 8)}...{wallet.address.slice(-8)}
                </button>
              </div>
            </div>

            {/* Balance Display */}
            <div className="text-center py-8">
              <div className="flex items-center justify-center gap-2 text-sm text-gold-200/60 mb-2">
                <span>BALANCE</span>
                <button
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className={`text-gold-400 hover:text-gold-300 transition-all ${isRefreshing ? 'animate-spin opacity-50' : ''}`}
                  title="Refresh balance"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                  </svg>
                </button>
              </div>
              <div className="text-6xl font-bold mb-2">
                <span className="text-white">{totalBalance.toFixed(4)}</span>
                <span className="text-gold-400 ml-2">ZEC</span>
              </div>
              <div className="text-xl text-gold-200/60">${usdValue.toFixed(2)} USD</div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-4 justify-center">
              <button
                onClick={handleShowReceive}
                className="px-8 py-3 border-2 border-gold-500 text-gold-400 font-bold rounded-lg hover:bg-gold-500/10 transition-all"
              >
                Receive
              </button>
              <button
                disabled
                className="px-8 py-3 bg-gold-400/30 text-black/50 font-bold rounded-lg cursor-not-allowed opacity-50"
                title="Send feature temporarily disabled"
              >
                Send
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-4 mb-6">
            <button
              onClick={() => setActiveTab('zrc20')}
              className={`flex-1 px-6 py-4 font-bold rounded-lg transition-all ${
                activeTab === 'zrc20'
                  ? 'bg-gold-500 text-black'
                  : 'glass-card text-gold-400'
              }`}
            >
              ZRC20 <span className="ml-2 opacity-60">1</span>
            </button>
            <button
              onClick={() => setActiveTab('inscriptions')}
              className={`flex-1 px-6 py-4 font-bold rounded-lg transition-all ${
                activeTab === 'inscriptions'
                  ? 'bg-gold-500 text-black'
                  : 'glass-card text-gold-400'
              }`}
            >
              Inscriptions <span className="ml-2 opacity-60">0</span>
            </button>
          </div>

          {/* Content Area */}
          {activeTab === 'zrc20' && (
            <div className="glass-card p-6">
              <div className="flex items-center gap-4 p-4 bg-black/40 rounded-lg">
                <div className="w-12 h-12 bg-gold-500 rounded-full flex items-center justify-center text-black font-bold">
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
            <div className="glass-card p-12 text-center">
              <div className="text-gold-200/60">No inscriptions yet</div>
            </div>
          )}

          {/* Disconnect Button */}
          <div className="mt-8 text-center">
            <button
              onClick={() => {
                if (confirm('This will delete your encrypted wallet from this device. Make sure you have backed up your seed phrase or private key!')) {
                  disconnectWallet();
                }
              }}
              className="text-gold-400/60 text-sm hover:text-red-400 transition-colors"
            >
              Disconnect (Forget) Wallet
            </button>
          </div>
        </div>
      </div>

      {/* Mnemonic Modal */}
      {showMnemonic && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6">
          <div className="glass-modal max-w-2xl w-full p-8">
            <h3 className="text-2xl font-bold text-gold-300 mb-4">
              BACKUP YOUR SEED PHRASE
            </h3>
            <div className="bg-gold-500/10 border border-gold-500/30 rounded p-4 mb-6">
              <p className="text-sm text-gold-300">
                <strong>IMPORTANT:</strong> Write down these 12 words in order. This is the only way to recover your wallet. Keep it private and secure.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-6">
              {wallet?.mnemonic.split(' ').map((word, i) => (
                <div key={i} className="bg-black/40 p-3 rounded text-center">
                  <span className="text-gold-200/60 text-xs">{i + 1}. </span>
                  <span className="text-gold-300 font-mono">{word}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-4">
              <button
                onClick={handleCopyMnemonic}
                className="flex-1 px-6 py-3 bg-gold-500/20 text-gold-400 font-bold rounded-lg border border-gold-500/30 hover:bg-gold-500/30 transition-all"
              >
                COPY TO CLIPBOARD
              </button>
              <button
                onClick={() => setShowMnemonic(false)}
                className="flex-1 px-6 py-3 bg-gold-500 text-black font-bold rounded-lg hover:bg-gold-400 transition-all"
              >
                I HAVE SAVED IT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receive Modal */}
      {showReceive && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6">
          <div className="glass-modal max-w-md w-full p-8 text-center">
            <h3 className="text-2xl font-bold text-gold-300 mb-6">RECEIVE ZEC</h3>
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="Wallet QR" className="mx-auto mb-6 rounded-lg" />
            )}
            <div className="bg-black/40 p-4 rounded mb-6">
              <p className="text-gold-300 font-mono text-sm break-all">{wallet.address}</p>
            </div>
            <div className="flex gap-4">
              <button
                onClick={handleCopyAddress}
                className="flex-1 px-6 py-3 bg-gold-500 text-black font-bold rounded-lg hover:bg-gold-400 transition-all"
              >
                COPY ADDRESS
              </button>
              <button
                onClick={() => setShowReceive(false)}
                className="flex-1 px-6 py-3 bg-gold-500/20 text-gold-400 font-bold rounded-lg border border-gold-500/30 hover:bg-gold-500/30 transition-all"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send Modal */}
      {showSend && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6">
          <div className="glass-modal max-w-md w-full p-8">
            <h3 className="text-2xl font-bold text-gold-300 mb-6">SEND ZEC</h3>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-gold-200/80 text-sm mb-2">To Address</label>
                <input
                  type="text"
                  value={sendForm.to}
                  onChange={(e) => setSendForm({ ...sendForm, to: e.target.value })}
                  disabled={isSending}
                  className="w-full bg-black/40 border border-gold-500/30 rounded px-4 py-3 text-gold-300 font-mono text-sm disabled:opacity-50"
                  placeholder="t1..."
                />
              </div>
              <div>
                <label className="block text-gold-200/80 text-sm mb-2">
                  Amount (ZEC)
                  <span className="float-right text-gold-400/60 text-xs">
                    Available: {totalBalance.toFixed(8)} ZEC
                  </span>
                </label>
                <input
                  type="number"
                  step="0.0001"
                  value={sendForm.amount}
                  onChange={(e) => setSendForm({ ...sendForm, amount: e.target.value })}
                  disabled={isSending}
                  className="w-full bg-black/40 border border-gold-500/30 rounded px-4 py-3 text-gold-300 disabled:opacity-50"
                  placeholder="0.0000"
                />
                <button
                  onClick={() => setSendForm({ ...sendForm, amount: totalBalance.toString() })}
                  disabled={isSending}
                  className="mt-2 text-xs text-gold-400 hover:text-gold-300 disabled:opacity-50"
                >
                  Send Max
                </button>
              </div>
            </div>
            <div className="bg-gold-500/10 border border-gold-500/30 rounded p-3 mb-6">
              <p className="text-xs text-gold-300">
                Network fees will be deducted automatically. Transaction cannot be reversed once broadcast.
              </p>
            </div>
            <div className="flex gap-4">
              <button
                onClick={handleSend}
                disabled={isSending || !sendForm.to || !sendForm.amount}
                className="flex-1 px-6 py-3 bg-gold-500 text-black font-bold rounded-lg hover:bg-gold-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSending ? 'SENDING...' : 'SEND'}
              </button>
              <button
                onClick={() => {
                  setSendForm({ to: '', amount: '' });
                  setShowSend(false);
                }}
                disabled={isSending}
                className="flex-1 px-6 py-3 bg-gold-500/20 text-gold-400 font-bold rounded-lg border border-gold-500/30 hover:bg-gold-500/30 transition-all disabled:opacity-50"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExport && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6">
          <div className="glass-modal max-w-md w-full p-8">
            <h3 className="text-2xl font-bold text-gold-300 mb-4">
              EXPORT PRIVATE KEY
            </h3>
            <div className="bg-gold-500/10 border border-gold-500/30 rounded p-4 mb-6">
              <p className="text-sm text-gold-300 mb-2">
                <strong>SECURITY NOTICE:</strong> Your private key provides full access to your wallet funds.
              </p>
              <ul className="text-xs text-gold-300 space-y-1 list-disc list-inside">
                <li>Keep your private key secure and private</li>
                <li>Store it offline in a safe location</li>
                <li>Be aware of screen recording software</li>
              </ul>
            </div>
            <div className="flex gap-4">
              <button
                onClick={confirmExport}
                className="flex-1 px-6 py-3 bg-gold-500 text-black font-bold rounded-lg hover:bg-gold-400 transition-all"
              >
                EXPORT KEY
              </button>
              <button
                onClick={() => setShowExport(false)}
                className="flex-1 px-6 py-3 bg-gold-500/20 text-gold-400 font-bold rounded-lg border border-gold-500/30 hover:bg-gold-500/30 transition-all"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .glass-card {
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(218, 165, 32, 0.2);
          backdrop-filter: blur(10px);
          border-radius: 16px;
        }

        .glass-modal {
          background: rgba(0, 0, 0, 0.9);
          border: 1px solid rgba(218, 165, 32, 0.3);
          backdrop-filter: blur(20px);
          border-radius: 16px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        }
      `}</style>
    </main>
  );
}
