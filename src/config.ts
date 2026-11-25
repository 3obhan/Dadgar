/**
 * Global Configuration for Dadgar - Mr Judger
 */

// Flat fee for official PDF decree - single source of truth used by server and client
export const PDF_PRICE_USD_CENTS = 100;
export const PDF_PRICE_USD = 1.0;

// Iranian Shetab fee via Variza (~$1 USD)
export const PDF_PRICE_TOMAN = 50000;
export const PDF_PRICE_TOMAN_FORMATTED = '۵۰,۰۰۰ تومان';
export const VARIZA_PAY_URL = 'https://variza.ir/pay/UrINperthQIgAAb3t2ZPS';

// PayPal Payment configuration
export const PAYPAL_RECIPIENT = 'ganjisobhan';
export const PAYPAL_ME_URL = 'https://paypal.me/ganjisobhan/1USD';
export const PAYPAL_ME_BASE = 'https://paypal.me/ganjisobhan';

// Base URLs
export const PUBLIC_APP_URL =
  typeof window !== 'undefined'
    ? window.location.origin
    : 'https://ais-pre-qpf4uxrtz42wzhfarhbgvp-18944585449.europe-west3.run.app';

export const API_BASE_URL = typeof window !== 'undefined' ? '' : '';

// Helper to open URLs externally safely without popup blocker issues
export function openExternalUrl(url: string) {
  if (typeof window === 'undefined' || !url) return;

  const win = window as any;
  if (win.AndroidNative && typeof win.AndroidNative.openExternal === 'function') {
    try {
      win.AndroidNative.openExternal(url);
      return;
    } catch {
      // Fallback
    }
  }

  // Use an anchor element click first to bypass browser popup blocker
  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) document.body.removeChild(a);
    }, 100);
    return;
  } catch (_) {}

  // Fallback to window.open
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (err) {
    console.warn('Could not open external url:', err);
  }
}

