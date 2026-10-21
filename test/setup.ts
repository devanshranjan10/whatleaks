// Tests must never reach the internet. Only loopback servers started by the tests themselves
// are allowed; everything else fails loudly.
const realFetch = globalThis.fetch;
globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]') {
    return realFetch(input, init);
  }
  throw new Error(`Network access is disabled in tests (tried ${url.href}).`);
};
