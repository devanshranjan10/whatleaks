import type { Category } from '../model.js';

export interface HostRule {
  /** Matches this host and its subdomains. */
  host: string;
  vendor: string;
  category: Category;
  /** Where the host is documented (vendor docs or the tool's own source). */
  source: string;
}

/**
 * Known telemetry, error-reporting and feature-flag ingestion hosts. Every entry
 * cites a public source; see docs/RESEARCH.md for when each was checked.
 */
export const HOST_RULES: readonly HostRule[] = [];
