import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { runSearchPipeline } from "../../core/pipeline/searchPipeline.js";
import { ResearchContextInputSchema, withObjective } from "../../types/context.js";
import { buildResponse, errorResponse } from "../../types/common.js";
import type { ToolMeta } from "../../types/toolMeta.js";

const paramsSchema = z.object({
  context: ResearchContextInputSchema.required({ company: true }),
  daysBack: z.number().int().positive().max(730).default(90),
});

export const latestNewsMeta: ToolMeta = {
  name: "latest_news",
  category: "news",
  description: "Recent news coverage of a company, sorted by publish date.",
  inputs: ["context.company", "daysBack"],
  outputs: ["articles[]"],
  requiredSources: ["news"],
  caching: true,
  estimatedRuntimeMs: 2000,
};

export function registerLatestNewsTool(server: FastMCP): void {
  server.addTool({
    name: "latest_news",
    description:
      "Retrieves recent news coverage of a company from Reuters, Economic Times, Mint, Business Standard, and Moneycontrol, sorted by publish date.",
    parameters: paramsSchema,
    annotations: { title: "Latest News", readOnlyHint: true, openWorldHint: true },
    execute: async (args) => {
      try {
        const context = withObjective(args.context, "news");
        const startPublishedDate = new Date(Date.now() - args.daysBack * 86_400_000).toISOString();

        const { results, citations, confidence } = await runSearchPipeline({
          context,
          templateKey: "latest",
          subject: context.company!,
          numResults: 10,
          startPublishedDate,
          cacheNamespace: "latest_news",
          cacheTtlSeconds: 900,
        });

        const sorted = [...results].sort((a, b) => {
          const dateA = a.publishedDate ? new Date(a.publishedDate).getTime() : 0;
          const dateB = b.publishedDate ? new Date(b.publishedDate).getTime() : 0;
          return dateB - dateA;
        });

        return buildResponse({
          success: true,
          data: {
            companyName: context.company,
            articles: sorted.map((r) => ({
              title: r.title,
              url: r.url,
              publishedDate: r.publishedDate,
              snippet: r.text.slice(0, 300),
            })),
          },
          citations,
          confidence,
          metadata: { windowDays: args.daysBack, resultCount: sorted.length },
        });
      } catch (err) {
        return errorResponse((err as Error).message);
      }
    },
  });
}
