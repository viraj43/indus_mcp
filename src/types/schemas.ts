import { z } from "zod";

/** Must stay in sync with the SourceTier union in src/sources/types.ts —
 * duplicated here as string literals because Zod enums need a literal
 * tuple, not a type import. */
export const SourceTierSchema = z.enum([
  "official_filing",
  "official_company",
  "annual_report",
  "government",
  "industry_report",
  "news",
  "blog",
]);

export const IncomeStatementSchema = z.object({
  revenue: z.number(),
  costOfGoodsSold: z.number().optional(),
  ebitda: z.number().optional(),
  ebit: z.number().optional(),
  netProfit: z.number(),
  interestExpense: z.number().optional(),
});

export const BalanceSheetSchema = z.object({
  totalAssets: z.number().optional(),
  totalEquity: z.number().optional(),
  totalDebt: z.number().optional(),
  currentAssets: z.number().optional(),
  currentLiabilities: z.number().optional(),
  inventory: z.number().optional(),
  cash: z.number().optional(),
});

export const CashFlowStatementSchema = z.object({
  operatingCashFlow: z.number().optional(),
  capex: z.number().optional(),
});

/** A single period's financials, grouped the way real financial statements
 * are (Income Statement / Balance Sheet / Cash Flow) instead of a flat bag
 * of fields — see core/financial/financialEngine.ts for the calculations
 * that consume this shape. */
export const FinancialStatementSchema = z.object({
  period: z.string().describe("Reporting period label, e.g. FY24"),
  incomeStatement: IncomeStatementSchema,
  balanceSheet: BalanceSheetSchema.default({}),
  cashFlow: CashFlowStatementSchema.default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type FinancialStatement = z.infer<typeof FinancialStatementSchema>;

export const ReportTableSchema = z.object({
  headers: z.array(z.string()),
  rows: z.array(z.array(z.union([z.string(), z.number()]))),
});

export const CitationSchema = z.object({
  source: z.string(),
  url: z.string(),
  publicationDate: z.string().nullable(),
  evidenceSnippet: z.string(),
  tier: SourceTierSchema,
  authority: z.number(),
  recencyPenalty: z.number(),
  confidenceScore: z.number(),
});

/** A self-contained unit of research: unlike a bare Markdown/HTML chunk, a
 * ResearchSection carries its own citations, confidence, and metadata —
 * so a report is an array of these, and Markdown/HTML/PDF are just
 * different ways of rendering the same underlying object (see
 * core/renderers/). */
export const ResearchSectionSchema = z.object({
  title: z.string(),
  summary: z.string(),
  tables: z.array(ReportTableSchema).default([]),
  citations: z.array(CitationSchema).default([]),
  confidence: z.number(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const ReportInputSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  companyName: z.string().optional(),
  generatedAt: z.string().optional(),
  sections: z.array(ResearchSectionSchema).min(1),
});

/** Types inferred directly from the Zod schemas above, so the report
 * engine, renderers, and tool parameter validation all share one
 * definition instead of drifting apart. */
export type ReportTable = z.infer<typeof ReportTableSchema>;
export type ResearchSection = z.infer<typeof ResearchSectionSchema>;
export type ReportInput = z.infer<typeof ReportInputSchema>;
