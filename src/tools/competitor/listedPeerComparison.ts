import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { runSearchPipeline } from "../../core/pipeline/searchPipeline.js";
import { ResearchContextInputSchema, withObjective } from "../../types/context.js";
import { buildResponse, errorResponse } from "../../types/common.js";
import type { ToolMeta } from "../../types/toolMeta.js";

const paramsSchema = z.object({
  context: ResearchContextInputSchema.required({ company: true }),
});

export const listedPeerComparisonMeta: ToolMeta = {
  name: "listed_peer_comparison",
  category: "competitor",
  description: "Financial peer-comparison data for a listed company from screener.in, Trendlyne, and exchange/finance-portal sources.",
  inputs: ["context.company"],
  outputs: ["peerMentions[]"],
  requiredSources: ["financialData", "exchange", "news"],
  caching: true,
  estimatedRuntimeMs: 2500,
};

const MARKET_CAP_REGEX = /market cap(?:italization)?[^.]{0,40}?([₹$]\s?[\d,.]+\s?(cr(ore)?s?|lakh?s?|billion|bn|million|mn))/i;
const PE_RATIO_REGEX = /P\/?E\s?(?:ratio)?[^.]{0,20}?(\d+(?:\.\d+)?)/i;

export function registerListedPeerComparisonTool(server: FastMCP): void {
  server.addTool({
    name: "listed_peer_comparison",
    description:
      "Retrieves financial peer-comparison data (market cap, P/E, shareholding pattern context) for a listed company from screener.in, Trendlyne, Ace Equity-adjacent sources, and exchange/finance portals. Use discover_competitors first to identify named peers, then this tool to compare them financially.",
    parameters: paramsSchema,
    annotations: { title: "Listed Peer Comparison", readOnlyHint: true, openWorldHint: true },
    execute: async (args) => {
      try {
        const context = withObjective(args.context, "competitors");
        const { results, citations, confidence } = await runSearchPipeline({
          context,
          templateKey: "peerComparison",
          subject: context.company!,
          numResults: 8,
          cacheNamespace: "listed_peer_comparison",
        });

        const peerMentions = results.map((r) => ({
          url: r.url,
          publishedDate: r.publishedDate,
          marketCapRaw: r.text.match(MARKET_CAP_REGEX)?.[1] ?? null,
          peRatio: r.text.match(PE_RATIO_REGEX)?.[1] ? parseFloat(r.text.match(PE_RATIO_REGEX)![1]) : null,
          snippet: r.text.slice(0, 300),
        }));

        return buildResponse({
          success: true,
          data: { companyName: context.company, peerMentions },
          citations,
          confidence,
          metadata: {
            note: "Figures are pattern-extracted from search snippets, not read from a structured screener/exchange table — verify against the source URL before quoting.",
          },
        });
      } catch (err) {
        return errorResponse((err as Error).message);
      }
    },
  });
}
