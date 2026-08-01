import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { runSearchPipeline } from "../../core/pipeline/searchPipeline.js";
import { ResearchContextInputSchema, withObjective } from "../../types/context.js";
import { buildResponse, errorResponse } from "../../types/common.js";
import type { ToolMeta } from "../../types/toolMeta.js";

const paramsSchema = z.object({
  context: ResearchContextInputSchema.required({ company: true }),
});

export const litigationHistoryMeta: ToolMeta = {
  name: "litigation_history",
  category: "litigation",
  description: "Hard regulatory/legal action record screen (SEBI, NCLT, court judgments) for a company or promoter.",
  inputs: ["context.company"],
  outputs: ["cases[]"],
  requiredSources: ["regulator", "legalMedia", "mca"],
  caching: true,
  estimatedRuntimeMs: 2500,
};

const CASE_REFERENCE_REGEX = /\b(?:WP|CA|CP|IA|CS|SLP)\s?\(?\s?[A-Z]*\s?\)?\s?\d{1,6}[\s/]\d{4}\b/i;
const REGULATOR_MENTION_REGEX = /\b(SEBI|RBI|NCLT|NCLAT|ROC|ED|CBI)\b/g;

export function registerLitigationHistoryTool(server: FastMCP): void {
  server.addTool({
    name: "litigation_history",
    description:
      "Screens SEBI, NCLT, and legal-journalism sources (IndianKanoon, LiveLaw, Bar & Bench) for litigation, regulatory penalties, insolvency proceedings, and director disqualification records tied to a company or promoter name. Distinct from negative_news, which screens general press/employee sentiment rather than hard legal/regulatory records.",
    parameters: paramsSchema,
    annotations: { title: "Litigation History", readOnlyHint: true, openWorldHint: true },
    execute: async (args) => {
      try {
        const context = withObjective(args.context, "litigation");
        const { results, citations, confidence } = await runSearchPipeline({
          context,
          templateKey: "litigation",
          subject: context.company!,
          numResults: 10,
          cacheNamespace: "litigation_history",
          cacheTtlSeconds: 1800,
        });

        const cases = results.map((r) => {
          const caseReference = r.text.match(CASE_REFERENCE_REGEX)?.[0] ?? null;
          const regulatorsMentioned = Array.from(new Set(Array.from(r.text.matchAll(REGULATOR_MENTION_REGEX), (m) => m[1])));
          return {
            title: r.title,
            url: r.url,
            publishedDate: r.publishedDate,
            caseReference,
            regulatorsMentioned,
            snippet: r.text.slice(0, 300),
          };
        });

        return buildResponse({
          success: true,
          data: {
            companyName: context.company,
            cases,
            recordClean: cases.length === 0,
          },
          citations,
          confidence,
          metadata: {
            note: "Hits require manual review — a name match on IndianKanoon/LiveLaw/SEBI does not by itself confirm the case involves this specific entity.",
          },
        });
      } catch (err) {
        return errorResponse((err as Error).message);
      }
    },
  });
}
