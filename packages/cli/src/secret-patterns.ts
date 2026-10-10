/**
 * Heuristics for "the user just pasted an API key into chat". Tuned for few false
 * positives: known key prefixes, plus "key/token/secret = <long token>" phrasing.
 * Plain hex (commit SHAs, hashes) and UUIDs are never flagged.
 */
const KNOWN_PREFIXES: Array<[label: string, pattern: RegExp]> = [
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/],
  ['secret key (sk_…)', /\bsk_(?:live_|test_)?[A-Za-z0-9]{16,}/],
  ['restricted key (rk_…)', /\brk_(?:live|test)_[A-Za-z0-9]{16,}/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{20,}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['Google API key', /\bAIza[A-Za-z0-9_-]{35}\b/],
  ['Resend key', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/],
  ['Hugging Face token', /\bhf_[A-Za-z0-9]{30,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

const LABELLED_TOKEN = /\b(?:api[_ -]?key|secret|token|password|bearer|authorization)\b(?:\s+(?:is|=))?["']?\s*[:=]?\s*["']?(?:bearer\s+)?([A-Za-z0-9_\-.+/=]{24,})/i;

const isHexOrUuid = (s: string) => /^[0-9a-f]+$/i.test(s) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const looksRandom = (s: string) => /[a-z]/.test(s) && /[A-Z0-9]/.test(s) && new Set(s).size >= 12;

export function findLikelySecret(text: string): string | undefined {
  for (const [label, pattern] of KNOWN_PREFIXES) {
    if (pattern.test(text)) return label;
  }
  const labelled = text.match(LABELLED_TOKEN)?.[1];
  if (labelled && !isHexOrUuid(labelled) && looksRandom(labelled)) return 'token';
  return undefined;
}

/** Users can deliberately send something that trips the guard by including this. */
export const ALLOW_MARKER = 'keybroker:allow';
