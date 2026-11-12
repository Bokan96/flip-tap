export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Share through the device's share sheet where there is one, otherwise copy to the clipboard.
 * 'failed' means neither worked; the caller then shows the text so it can be copied by hand.
 */
export async function shareOrCopy(data: { title: string; text: string; url?: string }): Promise<ShareResult> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
      // Not allowed here (e.g. desktop without a share target): fall back to copying.
    }
  }
  const full = data.url ? `${data.text}\n${data.url}` : data.text;
  try {
    await navigator.clipboard.writeText(full);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** The game's own address (without any #replay= part). */
export function gameUrl(): string {
  return `${location.origin}${location.pathname}`;
}

export function replayUrl(code: string): string {
  return `${gameUrl()}#replay=${code}`;
}

/** The replay code in the address bar, if any. */
export function replayCodeFromHash(hash = location.hash): string | null {
  const m = /^#replay=([A-Za-z0-9_-]+)$/.exec(hash);
  return m ? m[1] : null;
}
