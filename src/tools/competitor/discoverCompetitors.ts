import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { runSearchPipeline } from "../../core/pipeline/searchPipeline.js";
import { ResearchContextInputSchema, withObjective } from "../../types/context.js";
import { buildResponse, errorResponse } from "../../types/common.js";
import type { ToolMeta } from "../../types/toolMeta.js";

const paramsSchema = z.object({
  context: ResearchContextInputSchema.required({ company: true }),
});

export const discoverCompetitorsMeta: ToolMeta = {
  name: "discover_competitors",
  category: "competitor",
  description: "Candidate competitor names extracted from industry-analyst and news text via pattern heuristics.",
  inputs: ["context.company", "context.sector"],
  outputs: ["candidateCompetitors[]"],
  requiredSources: ["industry", "news"],
  caching: true,
  estimatedRuntimeMs: 2500,
};

const COMPETITOR_MENTION_REGEX = /(?:competitors?(?:\s+include|\s+such\s+as|:)?|rivals?(?:\s+such\s+as)?|compet(?:e|ing)\s+with)\s+((?:[A-Z][\w&.'-]*\s*){1,4}(?:,\s*(?:[A-Z][\w&.'-]*\s*){1,4}){0,4})/g;

function extractCandidateNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(COMPETITOR_MENTION_REGEX)) {
    match[1]
      .split(/,|\band\b/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length < 60)
      .forEach((s) => names.add(s));
  }
  return Array.from(names);
}

export function registerDiscoverCompetitorsTool(server: FastMCP): void {
  server.addTool({
    name: "discover_competitors",
    description:
      "Searches industry-analyst and news sources for named competitors/rivals of a company and extracts candidate competitor names via text-pattern heuristics. Results should be treated as a starting candidate list, not a verified peer set.",
    parameters: paramsSchema,
    annotations: { title: "Discover Competitors", readOnlyHint: true, openWorldHint: true },
    execute: async (args) => {
      try {
        const context = withObjective(args.context, "competitors");
        const subject = context.sector ? `${context.company} in ${context.sector}` : context.company!;

        const { results, citations, confidence } = await runSearchPipeline({
          context,
          templateKey: "competitors",
          subject,
          numResults: 8,
          cacheNamespace: "discover_competitors",
        });

        const candidateSet = new Set<string>();
        for (const r of results) {
          extractCandidateNames(r.text).forEach((name) => candidateSet.add(name));
        }

        return buildResponse({
          success: true,
          data: {
            companyName: context.company,
            candidateCompetitors: Array.from(candidateSet),
          },
          citations,
          confidence: Math.min(confidence, 0.65),
          metadata: {
            extractionMethod: "heuristic_text_pattern",
            note: "Candidate names are pattern-extracted, not verified — cross-check against listed_peer_comparison before use in a report.",
          },
        });
      } catch (err) {
        return errorResponse((err as Error).message);
      }
    },
  });
}
