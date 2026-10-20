/** Lose a successful HTTP response after its body and server write complete. */
export function createResponseFaults(paths: { workflow: string; account: string }) {
  let next: keyof typeof paths | undefined;
  return {
    discard(operation: keyof typeof paths) { next = operation; },
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const response = await fetch(input, init);
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (next && url.pathname === paths[next] && response.ok) {
        const operation = next;
        next = undefined;
        await response.arrayBuffer();
        throw new TypeError(`The fixture discarded the committed ${operation} response.`);
      }
      return response;
    },
  };
}
