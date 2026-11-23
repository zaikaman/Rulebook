/** A short display form of an address; the full value belongs in a `title` attribute. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
