import type { SourceProfile } from "../types.js";

/** Private-company and funding data aggregators, alongside
 * sources/company's Crunchbase entry — used when a company isn't listed
 * and has no exchange/MCA-registry financial trail to search instead. */
export const PRIVATE_DATA_PROFILE: SourceProfile = {
  name: "privateData",
  domains: ["pitchbook.com", "dealroom.co", "craft.co", "owler.com"],
  searchTemplates: {
    funding: (subject) => `${subject} funding investors valuation`,
    competitors: (subject) => `${subject} competitors comparable companies`,
  },
  confidence: 0.75,
  tier: "official_company",
  supportsPDF: false,
  supportsHTML: true,
};
