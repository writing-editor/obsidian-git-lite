import { requestUrl } from 'obsidian';

/**
 * isomorphic-git's `http` client interface. On mobile, Obsidian's WebView
 * blocks or mishandles cross-origin fetch/XHR to github.com in ways that
 * break isomorphic-git's default web client, so this routes everything
 * through Obsidian's own requestUrl (native networking, no CORS layer).
 */
export const vaultHttp = {
  async request({
    url,
    method = 'GET',
    headers = {},
    body,
  }: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    /** isomorphic-git's real GitHttpRequest type — an async iterable of chunks, not a plain array. */
    body?: AsyncIterableIterator<Uint8Array>;
  }) {
    const bodyBuf = body ? await drain(body) : undefined;

    const res = await requestUrl({
      url,
      method,
      headers,
      body: bodyBuf ? (bodyBuf.buffer.slice(bodyBuf.byteOffset, bodyBuf.byteOffset + bodyBuf.byteLength) as ArrayBuffer) : undefined,
      throw: false,
    });

    const respHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers ?? {})) {
      respHeaders[k.toLowerCase()] = String(v);
    }

    return {
      url,
      method,
      statusCode: res.status,
      statusMessage: String(res.status),
      body: toAsyncIterable(new Uint8Array(res.arrayBuffer)),
      headers: respHeaders,
    };
  },
};

/** Reads an async iterable of Uint8Array chunks into one concatenated buffer. */
async function drain(iter: AsyncIterableIterator<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of iter) chunks.push(chunk);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Wraps a single buffer as the async-iterable shape isomorphic-git expects for a response body. */
async function* toAsyncIterable(data: Uint8Array): AsyncIterableIterator<Uint8Array> {
  yield data;
}
