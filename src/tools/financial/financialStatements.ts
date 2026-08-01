import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { runSearchPipeline } from "../../core/pipeline/searchPipeline.js";
import { ResearchContextInputSchema, withObjective, type ResearchContextInput } from "../../types/context.js";
import { parseFinancialTable, findLineItem } from "../../core/extraction/tableExtractor.js";
import { findKeywordContexts } from "../../core/extraction/pdfExtractor.js";
import { buildResponse, errorResponse, type ToolResult } from "../../types/common.js";
import { buildEvidenceMetadata } from "../shared/evidenceMetadata.js";
import { labelDomains } from "../../sources/labels.js";
import type { ToolMeta } from "../../types/toolMeta.js";

const paramsSchema = z.object({
  context: ResearchContextInputSchema.required({ company: true }),
});

export const financialStatementsMeta: ToolMeta = {
  name: "financial_statements",
  category: "financial",
  description: "Locates a company's annual report / financial filing and extracts structured line-item tables.",
  inputs: ["context.company", "context.listed"],
  outputs: ["status", "lineItems", "periods", "extractionMethod"],
  requiredSources: ["exchange", "mca", "financialData", "privateData"],
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

export type FinancialStatementsData =
  | {
      companyName: string;
      status: "not_available";
      reason: string;
      recommendedSources: string[];
      rawSnippets?: { url: string; snippet: string }[];
    }
  | {
      companyName: string;
      status: "available";
      primarySourceUrl: string;
      extractionMethod: "html_tables" | "pdf_keyword_context" | "snippet_only";
      periods: string[];
      lineItems?: Record<string, (number | null)[]>;
      keywordContexts?: Record<string, string[]>;
    };

export async function getFinancialStatements(contextInput: ResearchContextInput): Promise<ToolResult<FinancialStatementsData>> {
  const context = withObjective(contextInput, "financials");
  // Listed companies' primary-source filings live on NSE/BSE (the
  // "listedFilings" template on the exchange profile); everyone else falls
  // back to the MCA-registry-style "filings" query.
  const templateKey = context.listed === "listed" ? "listedFilings" : "filings";
  const { results, citations, confidence, evidence, domainsChecked, entityRejectedCount, deepExtraction } =
    await runSearchPipeline({
      context,
      templateKey,
      subject: context.company!,
      numResults: 5,
      cacheNamespace: "financial_statements",
      deepExtract: true,
      verifyEntity: context.company,
    });

  const recommendedSources = labelDomains(domainsChecked);
  const metadata = buildEvidenceMetadata({ evidence, domainsChecked, entityRejectedCount });

  if (results.length === 0) {
    return {
      data: {
        companyName: context.company!,
        status: "not_available",
        reason:
          context.listed === "unlisted"
            ? "No financial data found for this private/unlisted company within the trusted source allowlist."
            : "No financial filing sources found for this company within the trusted source allowlist.",
        recommendedSources,
      },
      citations,
      confidence: 0,
      metadata,
    };
  }

  const extracted: { lineItems: Record<string, (number | null)[]>; periods: string[] } = { lineItems: {}, periods: [] };
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
    if (Object.values(pdfContexts).some((ctxs) => ctxs.length > 0)) extractionMethod = "pdf_keyword_context";
  }

  const hasStructuredData = Object.keys(extracted.lineItems).length > 0;
  const hasKeywordContext = extractionMethod === "pdf_keyword_context";

  if (!hasStructuredData && !hasKeywordContext) {
    return {
      data: {
        companyName: context.company!,
        status: "not_available",
        reason:
          "Sources were found for this company, but no structured financial tables or line-item figures could be parsed from them (often a paywalled aggregator page or a PDF the automated extractor couldn't read).",
        recommendedSources,
        rawSnippets: results.slice(0, 3).map((r) => ({ url: r.url, snippet: r.text.slice(0, 400) })),
      },
      citations,
      confidence: Math.min(confidence, 0.4),
      metadata,
    };
  }

  return {
    data: {
      companyName: context.company!,
      status: "available",
      primarySourceUrl: deepExtraction?.url ?? results[0].url,
      extractionMethod,
      periods: extracted.periods,
      lineItems: hasStructuredData ? extracted.lineItems : undefined,
      keywordContexts: hasKeywordContext ? pdfContexts : undefined,
    },
    citations,
    confidence: hasStructuredData ? confidence : Math.min(confidence, 0.6),
    metadata,
  };
}

export function registerFinancialStatementsTool(server: FastMCP): void {
  server.addTool({
    name: "financial_statements",
    description:
      "Locates a company's annual report / financial statement filing and extracts structured line-item tables (revenue, net profit, EBITDA, assets, equity, debt) from the underlying HTML or PDF document. Never returns bare nulls — when data can't be found, returns a structured not_available status naming which sources were checked and where to look manually.",
    parameters: paramsSchema,
    annotations: { title: "Financial Statements", readOnlyHint: true, openWorldHint: true },
    execute: async (args) => {
      try {
        const result = await getFinancialStatements(args.context);
        return buildResponse({ success: true, ...result });
      } catch (err) {
        return errorResponse((err as Error).message);
      }
    },
  });
}
