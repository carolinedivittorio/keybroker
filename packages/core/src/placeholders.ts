/**
 * Placeholders stand in for secrets in the agent's environment, e.g.
 * `ELEVENLABS_API_KEY=keybroker-managed:elevenlabs`. They are self-describing so
 * an agent that inspects the variable learns the key is handled for it.
 */
export const PLACEHOLDER_PREFIX = 'keybroker-managed:';

const PLACEHOLDER_RE = /keybroker-managed(?::|%3A)([a-z0-9_-]+)/gi;

export function placeholderFor(name: string): string {
  return `${PLACEHOLDER_PREFIX}${name}`;
}

/** Credential names referenced by placeholders anywhere in the given strings. */
export function findPlaceholders(...haystacks: string[]): string[] {
  const names = new Set<string>();
  for (const text of haystacks) {
    for (const match of text.matchAll(PLACEHOLDER_RE)) names.add(match[1].toLowerCase());
  }
  return [...names];
}
