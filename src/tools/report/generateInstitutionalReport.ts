import path from "node:path";
import { z } from "zod";
import type { FastMCP } from "fastmcp";
import { buildInstitutionalReport } from "../../core/orchestration/institutionalReport.js";
import { toJson, toMarkdown, toHtml, summarizeReport } from "../../core/reports/reportEngine.js";
import { ensurePdfDownloadRoute, renderAndSavePdf } from "../shared/pdfDelivery.js";
import { makeEnvelope, errorResponse } from "../../types/common.js";
import type { ToolMeta } from "../../types/toolMeta.js";

export const generateInstitutionalReportMeta: ToolMeta = {
  name: "generate_institutional_report",
  category: "report",
  description:
    "Single-call composite tool: orchestrates company profile, financials, industry, ranked competitors, funding, litigation/promoter/negative-news risk screening, and recent news internally, then composes and renders the full report. The caller receives a finished report, not a plan to execute.",
  inputs: ["company", "reportType", "country", "listed", "sector?", "companyDomain?", "outputFormats?"],
  outputs: ["report (json/markdown/html/pdf per outputFormats)"],
  requiredSources: ["company", "mca", "exchange", "financialData", "privateData", "industry", "regulator", "legalMedia", "news", "socialSentiment"],
  caching: true,
  estimatedRuntimeMs: 12000,
};

const paramsSchema = z.object({
  company: z.string().min(1).describe("Company (or promoter/legal entity) name to research"),
  reportType: z.enum(["debt_raising", "credit_assessment", "equity_research", "general_diligence"]).default("general_diligence"),
  country: z.enum(["india", "global"]).default("india"),
  listed: z.enum(["listed", "unlisted", "unknown"]).default("unknown"),
  sector: z.string().optional().describe("Industry/sector, enables the Industry Overview section"),
  companyDomain: z.string().optional().describe("Company's own website domain, e.g. acme.com"),
  outputFormats: z
    .array(z.enum(["json", "markdown", "html", "pdf"]))
    .min(1)
    .default(["json"])
    .describe("Which rendered formats to include in the response"),
});

export function registerGenerateInstitutionalReportTool(server: FastMCP): void {
  ensurePdfDownloadRoute(server);

  server.addTool({
    name: "generate_institutional_report",
    description:
      "Generates a complete institutional research report for a company in one call: company profile, financial snapshot, industry overview, a server-ranked competitor list, funding history, a combined litigation/promoter/adverse-media risk screen (with an evidence checklist of exactly which sources were checked), and recent news — composed into report sections and rendered in the requested output formats (json/markdown/html/pdf). Use this instead of calling search_company, company_profile, financial_statements, discover_competitors, litigation_history, promoter_background, negative_news, latest_news, and generate_pdf separately.",
    parameters: paramsSchema,
    annotations: { title: "Generate Institutional Report", readOnlyHint: false, openWorldHint: true, idempotentHint: false },
    execute: async (args) => {
      try {
        const { report, phaseErrors } = await buildInstitutionalReport({
          company: args.company,
          reportType: args.reportType,
          country: args.country,
          listed: args.listed,
          sector: args.sector,
          companyDomain: args.companyDomain,
        });

        const { citations, confidence } = summarizeReport(report);
        const data: Record<string, unknown> = {};

        if (args.outputFormats.includes("json")) data.json = toJson(report);
        if (args.outputFormats.includes("markdown")) data.markdown = toMarkdown(report);

        let html: string | undefined;
        if (args.outputFormats.includes("html") || args.outputFormats.includes("pdf")) {
          html = toHtml(report);
        }
        if (args.outputFormats.includes("html")) data.html = html;

        let pdfResource: { uri: string; mimeType: string; blob: string } | undefined;
        if (args.outputFormats.includes("pdf") && html) {
          const pdf = await renderAndSavePdf(html, report.title, report.companyName ?? report.brandName);
          data.pdf = { filePath: pdf.filePath, sizeBytes: pdf.sizeBytes, downloadUrl: pdf.downloadUrl };
          pdfResource = { uri: `induss-report:///${path.basename(pdf.filePath)}`, mimeType: "application/pdf", blob: pdf.base64 };
        }

        const envelope = makeEnvelope({
          success: true,
          data,
          citations,
          confidence,
          metadata: {
            sectionCount: report.sections.length,
            sectionsIncluded: report.sections.map((s) => s.title),
            phaseErrors: phaseErrors.length ? phaseErrors : undefined,
          },
        });

        if (!pdfResource) {
          return JSON.stringify(envelope);
        }

        return {
          content: [
            { type: "text", text: JSON.stringify(envelope) },
            { type: "resource", resource: pdfResource },
          ],
        };
      } catch (err) {
        return errorResponse((err as Error).message);
      }
    },
  });
}
