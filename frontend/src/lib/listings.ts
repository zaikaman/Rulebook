import { getTemplate, type Listing } from '@rulebook/shared';

/** The human title a listing renders: the author's name, or the template with its rule id. */
export function listingTitle(listing: Listing): string {
  if (listing.name) return listing.name;
  const template = getTemplate(listing.template);
  return `${template?.name ?? 'Rule'} #${listing.rule_id.toString()}`;
}

/** Success rate exactly as the API reported it: a percentage of executions, never a guess. */
export function successRateLabel(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/** A short display form of an address; the full value belongs in a `title` attribute. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
