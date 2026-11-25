/**
 * Utility functions for robust case sharing links and clipboard copying.
 * Works seamlessly across iframes, mobile browsers, and serverless environments.
 */

export interface CasePayload {
  caseId: string;
  partyA: {
    name: string;
    claimText: string;
    evidenceNotes?: string;
  };
  partyB?: {
    name: string;
    claimText: string;
    evidenceNotes?: string;
  };
  lang?: 'fa' | 'en';
}

export function encodeCasePayload(payload: Partial<CasePayload>): string {
  try {
    const compact = {
      id: payload.caseId,
      a: payload.partyA?.name,
      ac: payload.partyA?.claimText,
      an: payload.partyA?.evidenceNotes,
      b: payload.partyB?.name,
      bc: payload.partyB?.claimText,
      bn: payload.partyB?.evidenceNotes,
      l: payload.lang,
    };
    const jsonStr = JSON.stringify(compact);
    const bytes = new TextEncoder().encode(jsonStr);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } catch (err) {
    console.warn('Could not encode case payload:', err);
    return '';
  }
}

export function decodeCasePayload(str: string): CasePayload | null {
  try {
    if (!str || typeof str !== 'string') return null;
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const jsonStr = new TextDecoder().decode(bytes);
    const compact = JSON.parse(jsonStr);
    if (!compact || (!compact.ac && !compact.id)) return null;

    return {
      caseId: compact.id || '',
      partyA: {
        name: compact.a || '',
        claimText: compact.ac || '',
        evidenceNotes: compact.an || '',
      },
      partyB: {
        name: compact.b || '',
        claimText: compact.bc || '',
        evidenceNotes: compact.bn || '',
      },
      lang: compact.l === 'en' ? 'en' : 'fa',
    };
  } catch (err) {
    console.warn('Could not decode case payload:', err);
    return null;
  }
}

/**
 * Universal clipboard copy with robust fallback for iframes and older browsers
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Try modern navigator.clipboard
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // Fall through to textarea execCommand fallback
    }
  }

  // 2. Fallback: invisible textarea + execCommand
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '-9999px';
    textArea.style.left = '-9999px';
    textArea.style.opacity = '0';
    textArea.setAttribute('readonly', '');
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.warn('Fallback copy failed:', err);
    return false;
  }
}
