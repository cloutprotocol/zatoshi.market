"use client";

import { randomBytes } from '@noble/hashes/utils';
import type { Wallet } from '@/lib/wallet';

const KEYSTORE_STORAGE_KEY = 'zatoshi_keystore_v1';

interface KeystorePayload {
  v: 1;
  s: string; // base64 salt
  i: string; // base64 iv
  d: string; // base64 ciphertext
}

function toBase64(u8: Uint8Array): string {
  if (typeof window === 'undefined') return '';
  return btoa(String.fromCharCode(...Array.from(u8)));
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  // Ensure salt is a standard Uint8Array with ArrayBuffer
  const saltBuffer = new Uint8Array(salt);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBuffer, iterations: 250_000 },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function hasKeystore(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem(KEYSTORE_STORAGE_KEY);
}

export function deleteKeystore() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(KEYSTORE_STORAGE_KEY);
}

export async function saveKeystore(wallet: Wallet, password: string): Promise<void> {
  const { mnemonic: _mnemonic, ...toStore } = wallet;
  const data = new TextEncoder().encode(JSON.stringify(toStore));
  const salt = new Uint8Array(randomBytes(16));
  const iv = new Uint8Array(randomBytes(12));
  const key = await deriveKey(password, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const payload: KeystorePayload = {
    v: 1,
    s: toBase64(salt),
    i: toBase64(iv),
    d: toBase64(ct),
  };
  localStorage.setItem(KEYSTORE_STORAGE_KEY, JSON.stringify(payload));
}

export async function loadKeystore(password: string): Promise<Wallet> {
  const raw = localStorage.getItem(KEYSTORE_STORAGE_KEY);
  if (!raw) throw new Error('No keystore found');
  const payload = JSON.parse(raw) as KeystorePayload;
  if (payload.v !== 1) throw new Error('Unsupported keystore version');
  const salt = fromBase64(payload.s);
  const iv = fromBase64(payload.i);
  const key = await deriveKey(password, salt);
  const pt = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, fromBase64(payload.d))
  );
  const json = new TextDecoder().decode(pt);
  const parsed = JSON.parse(json) as Omit<Wallet, 'mnemonic'> & { mnemonic?: string };
  return { ...parsed, mnemonic: parsed.mnemonic || '' } as Wallet;
}

export { KEYSTORE_STORAGE_KEY };

