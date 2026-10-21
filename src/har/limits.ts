/**
 * WebSocket messages the app sent, kept per connection (in `websocket.samples`) so they
 * can be scanned like request bodies. A connection that streams for hours stops being
 * kept at these limits; its message count keeps going up.
 */
export const MAX_WS_MESSAGES = 1000;
export const MAX_WS_MESSAGE_CHARS = 64 * 1024;
export const MAX_WS_TOTAL_CHARS = 1024 * 1024;

/** The text kept for one WebSocket message, or undefined once the connection's budget is spent. */
export function keepWsMessage(kept: { samples: string[]; chars?: number }, text: string): string | undefined {
  const t = text.slice(0, MAX_WS_MESSAGE_CHARS);
  const used = kept.chars ?? kept.samples.reduce((n, s) => n + s.length, 0);
  if (kept.samples.length >= MAX_WS_MESSAGES || used + t.length > MAX_WS_TOTAL_CHARS) return undefined;
  return t;
}
