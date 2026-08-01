import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { runSearchPipeline } from "../../core/pipeline/searchPipeline.js";
import { ResearchContextInputSchema, withObjective } from "../../types/context.js";
import { buildResponse, errorResponse } from "../../types/common.js";
import type { ToolMeta } from "../../types/toolMeta.js";

const paramsSchema = z.object({
  context: ResearchContextInputSchema.required({ company: true }).describe(
    "context.company should be the promoter/director's name, or the company name if screening its leadership generally",
  ),
});

export const promoterBackgroundMeta: ToolMeta = {
  name: "promoter_background",
  category: "promoter",
  description: "Screens a promoter/director name for disqualification, debarment, or regulatory penalty records.",
  inputs: ["context.company (promoter/director name)"],
  outputs: ["flags[]"],
  requiredSources: ["regulator", "mca", "company"],
  caching: true,
  estimatedRuntimeMs: 2500,
};

const DISQUALIFICATION_REGEX = /disqualif(?:ied|ication)|debarred|barred from|penalty order|show[\s-]cause/i;

export function registerPromoterBackgroundTool(server: FastMCP): void {
  server.addTool({
    name: "promoter_background",
    description:
      "Screens a promoter or director name against SEBI/MCA/registry sources for disqualification, debarment, or regulatory penalty records. Pass the individual's name (or the company name to screen its leadership generally) as context.company.",
    parameters: paramsSchema,
    annotations: { title: "Promoter Background Check", readOnlyHint: true, openWorldHint: true },
    execute: async (args) => {
      try {
        const context = withObjective(args.context, "promoters");
        const { results, citations, confidence } = await runSearchPipeline({
          context,
          templateKey: "promoterCheck",
          subject: context.company!,
          numResults: 8,
          cacheNamespace: "promoter_background",
          cacheTtlSeconds: 1800,
        });

        const flags = results
          .filter((r) => DISQUALIFICATION_REGEX.test(r.text))
          .map((r) => ({
            title: r.title,
            url: r.url,
            publishedDate: r.publishedDate,
            snippet: r.text.slice(0, 300),
          }));

        return buildResponse({
          success: true,
          data: {
            name: context.company,
            flags,
            screenClean: flags.length === 0,
          },
          citations,
          confidence: flags.length > 0 ? confidence : Math.min(confidence, 0.6),
          metadata: {
            note: "A hit requires manual review to confirm the record refers to this specific individual — common names produce false positives.",
          },
        });
      } catch (err) {
        return errorResponse((err as Error).message);
      }
    },
  });
}
