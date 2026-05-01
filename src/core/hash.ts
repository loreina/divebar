import { canonicalize } from '../utils/canonicalize';

// compute a stable sha-256 hash of an ir's canonical form
export async function hashIR(ir: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalize(ir));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
