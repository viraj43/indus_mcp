import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { runSearchPipeline } from "../../core/pipeline/searchPipeline.js";
import { ResearchContextInputSchema, withObjective } from "../../types/context.js";
import { buildResponse, errorResponse } from "../../types/common.js";
import type { ToolMeta } from "../../types/toolMeta.js";

const paramsSchema = z.object({
  context: ResearchContextInputSchema.required({ company: true }),
});

export const negativeNewsMeta: ToolMeta = {
  name: "negative_news",
  category: "news",
  description: "Adverse media + employee/public sentiment screen (fraud, layoffs, complaints, controversy) for due diligence.",
  inputs: ["context.company"],
  outputs: ["flaggedArticles[]", "screenClean"],
  requiredSources: ["news", "socialSentiment"],
  caching: true,
  estimatedRuntimeMs: 2000,
};

const NEGATIVE_KEYWORDS = [
  "fraud",
  "lawsuit",
  "investigation",
  "scam",
  "default",
  "penalty",
  "layoffs",
  "scandal",
  "probe",
  "ban",
  "complaint",
  "controversy",
];

export function registerNegativeNewsTool(server: FastMCP): void {
  server.addTool({
    name: "negative_news",
    description:
      "Screens news and public-sentiment sources (Glassdoor, Reddit) for adverse media and complaints about a company (fraud, layoffs, defaults, employee/public controversy) for due-diligence / risk-screening purposes. For hard regulatory/legal records (SEBI, NCLT, court cases), use litigation_history instead.",
    parameters: paramsSchema,
    annotations: { title: "Negative News Screen", readOnlyHint: true, openWorldHint: true },
    execute: async (args) => {
      try {
        const context = withObjective(args.context, "sentiment");
        const { results, citations, confidence } = await runSearchPipeline({
          context,
          templateKey: "sentiment",
          subject: context.company!,
          numResults: 10,
          cacheNamespace: "negative_news",
          cacheTtlSeconds: 1800,
        });

        const flagged = results
          .map((r) => {
            const matchedKeywords = NEGATIVE_KEYWORDS.filter((kw) => new RegExp(`\\b${kw}\\b`, "i").test(r.text));
            if (matchedKeywords.length === 0) return null;
            return {
              title: r.title,
              url: r.url,
              publishedDate: r.publishedDate,
              matchedKeywords,
              snippet: r.text.slice(0, 300),
            };
          })
          .filter((e): e is NonNullable<typeof e> => e !== null);

        return buildResponse({
          success: true,
          data: { companyName: context.company, flaggedArticles: flagged, screenClean: flagged.length === 0 },
          citations,
          confidence,
          metadata: {
            keywordsUsed: NEGATIVE_KEYWORDS,
            note: "Keyword-based screen; a hit requires manual review to confirm relevance and materiality.",
          },
        });
      } catch (err) {
        return errorResponse((err as Error).message);
      }
    },
  });
}
