import type { Destination, IdValue, Report } from '../model.js';

/** Ids seen in two or more requests of one run. */
export function repeatedIds(report: Report): IdValue[] {
  return report.ids.filter((x) => x.requests >= 2);
}

/** `analytics · Segment` for catalog hosts, `analytics?` for guesses, `other` otherwise. */
export function destinationCategory(report: Report, d: Destination): string {
  const eps = report.endpoints.filter((e) => e.host === d.host);
  const vendor = eps.find((e) => e.classification.basis === 'catalog' && e.classification.category === d.category)?.classification.vendor;
  if (vendor) return `${d.category} · ${vendor}`;
  const guessed = eps.some((e) => e.classification.basis === 'heuristic' && e.classification.category === d.category);
  return guessed ? `${d.category}?` : d.category;
}
