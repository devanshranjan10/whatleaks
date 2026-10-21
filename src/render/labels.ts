import type { Destination, Report } from '../model.js';

/** `analytics · Segment` for catalog hosts, `analytics?` for guesses, `other` otherwise. */
export function destinationCategory(report: Report, d: Destination): string {
  const eps = report.endpoints.filter((e) => e.host === d.host);
  const vendor = eps.find((e) => e.classification.basis === 'catalog' && e.classification.category === d.category)?.classification.vendor;
  if (vendor) return `${d.category} · ${vendor}`;
  const guessed = eps.some((e) => e.classification.basis === 'heuristic' && e.classification.category === d.category);
  return guessed ? `${d.category}?` : d.category;
}
