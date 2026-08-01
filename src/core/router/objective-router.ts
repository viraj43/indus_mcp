import type { SourceName } from "../../sources/index.js";

export type ResearchObjective =
  | "company_overview"
  | "financials"
  | "funding"
  | "industry"
  | "macro"
  | "news"
  | "litigation"
  | "promoters"
  | "competitors";

/** Maps a high-level research objective to the source(s) whose domains
 * should be searched. This is the only place objective→source policy
 * lives; source-router.ts turns the result into a concrete domain
 * allowlist by pulling each source profile's domains. */
export const OBJECTIVE_SOURCES: Record<ResearchObjective, SourceName[]> = {
  company_overview: ["company", "mca"],
  financials: ["mca"],
  funding: ["mca", "company"],
  industry: ["industry"],
  macro: ["macro", "government"],
  news: ["news"],
  litigation: ["mca", "news"],
  promoters: ["mca", "company"],
  competitors: ["industry", "news"],
};

export function resolveSources(objective: ResearchObjective): SourceName[] {
  return OBJECTIVE_SOURCES[objective] ?? [];
}
