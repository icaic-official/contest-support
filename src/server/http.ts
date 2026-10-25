import { AuthenticationError } from './authentication';

/** Read at most `limit` bytes without trusting Content-Length. Do not retain request credentials. */
export async function readBody(request: Request, limit: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new AuthenticationError(400, 'A request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AuthenticationError(400, 'The request body is too large.');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AuthenticationError) throw error;
    throw new AuthenticationError(400, 'The request body could not be read.');
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Read a bounded body before JSON parsing. */
export async function readJsonBody(request: Request, limit = 16_384): Promise<unknown> {
  const bytes = await readBody(request, limit);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new AuthenticationError(400, 'The JSON request body is invalid.');
  }
}
