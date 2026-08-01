import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { runSearchPipeline } from "../../core/pipeline/searchPipeline.js";
import { ResearchContextInputSchema, withObjective } from "../../types/context.js";
import { buildResponse, errorResponse } from "../../types/common.js";
import type { ToolMeta } from "../../types/toolMeta.js";

const paramsSchema = z.object({
  context: ResearchContextInputSchema.required({ sector: true }),
});

export const industryOverviewMeta: ToolMeta = {
  name: "industry_overview",
  category: "industry",
  description: "Industry overview (structure, key players, growth drivers) from consulting/analyst sources.",
  inputs: ["context.sector", "context.country"],
  outputs: ["summary", "sourceUrls"],
  requiredSources: ["industry"],
  caching: true,
  estimatedRuntimeMs: 2500,
};

export function registerIndustryOverviewTool(server: FastMCP): void {
  server.addTool({
    name: "industry_overview",
    description:
      "Retrieves an industry overview (structure, key players, growth drivers) from top-tier consulting/research sources (Deloitte, PwC, EY, KPMG, McKinsey, Bain, BCG, IMARC, Statista, NASSCOM).",
    parameters: paramsSchema,
    annotations: { title: "Industry Overview", readOnlyHint: true, openWorldHint: true },
    execute: async (args) => {
      try {
        const context = withObjective(args.context, "industry");
        const subject = context.country === "india" ? `${context.sector} in India` : context.sector!;
        const { results, citations, confidence } = await runSearchPipeline({
          context,
          templateKey: "overview",
          subject,
          numResults: 8,
          cacheNamespace: "industry_overview",
        });

        return buildResponse({
          success: true,
          data: {
            industry: context.sector,
            summary: results.slice(0, 4).map((r) => r.text.slice(0, 500)).join("\n\n"),
            sourceUrls: results.map((r) => r.url),
          },
          citations,
          confidence,
          metadata: { resultCount: results.length },
        });
      } catch (err) {
        return errorResponse((err as Error).message);
      }
    },
  });
}
