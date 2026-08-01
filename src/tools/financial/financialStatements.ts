import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { runSearchPipeline } from "../../core/pipeline/searchPipeline.js";
import { ResearchContextInputSchema, withObjective } from "../../types/context.js";
import { parseFinancialTable, findLineItem } from "../../core/extraction/tableExtractor.js";
import { findKeywordContexts } from "../../core/extraction/pdfExtractor.js";
import { buildResponse, errorResponse } from "../../types/common.js";
import type { ToolMeta } from "../../types/toolMeta.js";

const paramsSchema = z.object({
  context: ResearchContextInputSchema.required({ company: true }),
});

export const financialStatementsMeta: ToolMeta = {
  name: "financial_statements",
  category: "financial",
  description: "Locates a company's annual report / financial filing and extracts structured line-item tables.",
  inputs: ["context.company", "context.listed"],
  outputs: ["lineItems", "periods", "extractionMethod"],
  requiredSources: ["exchange", "mca"],
  caching: true,
  estimatedRuntimeMs: 4000,
};

const KEY_LINE_ITEM_PATTERNS: Record<string, RegExp> = {
  revenue: /total (income|revenue)|revenue from operations/i,
  netProfit: /net profit|profit after tax|profit for the (year|period)/i,
  ebitda: /ebitda/i,
  totalAssets: /total assets/i,
  totalEquity: /total equity|shareholders'? funds/i,
  totalDebt: /total (debt|borrowings)/i,
};

export function registerFinancialStatementsTool(server: FastMCP): void {
  server.addTool({
    name: "financial_statements",
    description:
      "Locates a company's annual report / financial statement filing and extracts structured line-item tables (revenue, net profit, EBITDA, assets, equity, debt) from the underlying HTML or PDF document.",
    parameters: paramsSchema,
    annotations: { title: "Financial Statements", readOnlyHint: true, openWorldHint: true },
    execute: async (args) => {
      try {
        const context = withObjective(args.context, "financials");
        // Listed companies' primary-source filings live on NSE/BSE (the
        // "listedFilings" template on the exchange profile); everyone else
        // falls back to the MCA-registry-style "filings" query.
        const templateKey = context.listed === "listed" ? "listedFilings" : "filings";
        const { results, citations, confidence, deepExtraction } = await runSearchPipeline({
          context,
          templateKey,
          subject: context.company!,
          numResults: 5,
          cacheNamespace: "financial_statements",
          deepExtract: true,
        });

        if (results.length === 0) {
          return buildResponse({
            success: false,
            data: null,
            citations,
            confidence: 0,
            error: "No financial filing sources found for this company within the trusted domain allowlist.",
          });
        }

        const extracted: { lineItems: Record<string, (number | null)[]>; periods: string[] } = {
          lineItems: {},
          periods: [],
        };
        let extractionMethod: "html_tables" | "pdf_keyword_context" | "snippet_only" = "snippet_only";
        const pdfContexts: Record<string, string[]> = {};

        if (deepExtraction?.contentType === "html" && deepExtraction.tables) {
          const tables = deepExtraction.tables.map(parseFinancialTable);
          for (const table of tables) {
            for (const [key, pattern] of Object.entries(KEY_LINE_ITEM_PATTERNS)) {
              const item = findLineItem(table, pattern);
              if (item && !extracted.lineItems[key]) {
                extracted.lineItems[key] = item.values;
                extracted.periods = table.periods;
              }
            }
          }
          if (Object.keys(extracted.lineItems).length > 0) extractionMethod = "html_tables";
        } else if (deepExtraction?.contentType === "pdf" && deepExtraction.pdfText) {
          Object.assign(
            pdfContexts,
            findKeywordContexts(deepExtraction.pdfText, Object.keys(KEY_LINE_ITEM_PATTERNS).concat(["Total Revenue", "Net Profit", "EBITDA"])),
          );
          extractionMethod = "pdf_keyword_context";
        }

        const hasStructuredData = Object.keys(extracted.lineItems).length > 0;

        return buildResponse({
          success: true,
          data: {
            companyName: context.company,
            primarySourceUrl: deepExtraction?.url ?? results[0].url,
            extractionMethod,
            periods: extracted.periods,
            lineItems: hasStructuredData ? extracted.lineItems : undefined,
            keywordContexts: extractionMethod === "pdf_keyword_context" ? pdfContexts : undefined,
            fallbackSnippets: extractionMethod === "snippet_only" ? results.slice(0, 3).map((r) => r.text.slice(0, 500)) : undefined,
          },
          citations,
          confidence: hasStructuredData ? confidence : Math.min(confidence, 0.5),
          metadata: {
            note: hasStructuredData
              ? undefined
              : "Structured tables could not be extracted automatically; review fallbackSnippets/keywordContexts manually.",
          },
        });
      } catch (err) {
        return errorResponse((err as Error).message);
      }
    },
  });
}
