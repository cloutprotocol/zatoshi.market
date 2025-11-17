"use client";
import { Buffer } from 'buffer';

// Provide Buffer globally for libs that expect Node Buffer in browser
if (typeof (globalThis as any).Buffer === 'undefined') {
  (globalThis as any).Buffer = Buffer;
}

