import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { runSearchPipeline } from "../../core/pipeline/searchPipeline.js";
import { ResearchContextInputSchema, withObjective } from "../../types/context.js";
import { buildResponse, errorResponse } from "../../types/common.js";
import type { ToolMeta } from "../../types/toolMeta.js";

const paramsSchema = z.object({
  context: ResearchContextInputSchema.required({ company: true }),
});

export const companyOverviewMeta: ToolMeta = {
  name: "company_overview",
  category: "company",
  description: "Narrative business overview: what the company does, products/services, target market.",
  inputs: ["context.company"],
  outputs: ["summary", "sourceUrls"],
  requiredSources: ["company", "mca"],
  caching: true,
  estimatedRuntimeMs: 2000,
};

export function registerCompanyOverviewTool(server: FastMCP): void {
  server.addTool({
    name: "company_overview",
    description:
      "Produces a narrative business overview (what the company does, products/services, target market) sourced from the company's own site and LinkedIn.",
    parameters: paramsSchema,
    annotations: { title: "Company Overview", readOnlyHint: true, openWorldHint: true },
    execute: async (args) => {
      try {
        const context = withObjective(args.context, "company_overview");
        const { results, citations, confidence } = await runSearchPipeline({
          context,
          templateKey: "overview",
          subject: context.company!,
          numResults: 6,
          cacheNamespace: "company_overview",
        });

        const summary = results
          .slice(0, 3)
          .map((r) => r.text.slice(0, 500))
          .join("\n\n");

        return buildResponse({
          success: true,
          data: {
            companyName: context.company,
            summary,
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
