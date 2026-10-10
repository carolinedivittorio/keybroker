import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { rootCertificates } from 'node:tls';
import { ProxyAgent, fetch } from 'undici';

export interface ProxiedRequestInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  saveTo?: string;
}

export interface ProxiedRequestResult {
  status: number;
  headers: Record<string, string>;
  body?: string;
  bodyTruncated?: boolean;
  bytes: number;
  savedTo?: string;
}

const MAX_TEXT_BODY = 100 * 1024;
const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|problem\+json|[\w.+-]*\+json|[\w.+-]*\+xml))/i;

/**
 * Make a request through the Keybroker proxy, so it gets exactly the same injection,
 * host rules and scrubbing as anything an agent runs in a shell. This never touches
 * secrets itself.
 */
export async function proxiedRequest(
  input: ProxiedRequestInput,
  proxy: { url: string; caCert: string },
): Promise<ProxiedRequestResult> {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new Error(`Invalid URL: ${input.url}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http(s) URLs are supported');
  if (input.saveTo && !isAbsolute(input.saveTo)) throw new Error('saveTo must be an absolute path');

  const agent = new ProxyAgent({
    uri: proxy.url,
    // Intercepted hosts present our CA; everything else is tunnelled and presents its real cert.
    requestTls: { ca: [proxy.caCert, ...rootCertificates] },
  });
  try {
    const res = await fetch(url, {
      method: input.method?.toUpperCase() ?? 'GET',
      headers: input.headers,
      body: input.body,
      dispatcher: agent,
      redirect: 'manual',
    });
    const buffer = Buffer.from(await res.arrayBuffer());
    const headers = Object.fromEntries(res.headers.entries());
    const result: ProxiedRequestResult = { status: res.status, headers, bytes: buffer.length };

    if (input.saveTo) {
      await writeFile(input.saveTo, buffer);
      result.savedTo = input.saveTo;
    } else if (buffer.length === 0 || TEXT_TYPES.test(headers['content-type'] ?? 'text/plain')) {
      result.body = buffer.subarray(0, MAX_TEXT_BODY).toString('utf8');
      if (buffer.length > MAX_TEXT_BODY) result.bodyTruncated = true;
    } else {
      result.body = `[${buffer.length} bytes of ${headers['content-type']}; pass saveTo to write it to a file]`;
    }
    return result;
  } finally {
    await agent.close();
  }
}
