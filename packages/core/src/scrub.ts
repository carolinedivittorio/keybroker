export const REDACTED = '[redacted by keybroker]';

/** Replace every occurrence of any needle in the buffer. Returns the same buffer when nothing matched. */
export function scrubBuffer(body: Buffer, needles: string[]): { body: Buffer; redactions: number } {
  let redactions = 0;
  let current = body;
  const replacement = Buffer.from(REDACTED);
  // Longest first so a base64 form isn't partially eaten by a shorter raw match.
  for (const needle of [...needles].sort((a, b) => b.length - a.length)) {
    const n = Buffer.from(needle);
    let idx = current.indexOf(n);
    if (idx === -1) continue;
    const parts: Buffer[] = [];
    let start = 0;
    while (idx !== -1) {
      parts.push(current.subarray(start, idx), replacement);
      redactions++;
      start = idx + n.length;
      idx = current.indexOf(n, start);
    }
    parts.push(current.subarray(start));
    current = Buffer.concat(parts);
  }
  return { body: current, redactions };
}

export function scrubString(text: string, needles: string[]): string {
  let out = text;
  for (const needle of [...needles].sort((a, b) => b.length - a.length)) out = out.split(needle).join(REDACTED);
  return out;
}
