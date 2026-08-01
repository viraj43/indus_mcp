import { promises as fs } from "node:fs";
import path from "node:path";
import type { FastMCP } from "fastmcp";
import { toHtml, summarizeReport } from "../../core/reports/reportEngine.js";
import { renderHtmlToPdf } from "../../core/pdf/pdfEngine.js";
import { ReportInputSchema } from "../../types/schemas.js";
import { slugify } from "../../core/renderers/shared.js";
import { buildResponse, errorResponse } from "../../types/common.js";
import type { ToolMeta } from "../../types/toolMeta.js";

export const generatePdfMeta: ToolMeta = {
  name: "generate_pdf",
  category: "export",
  description: "Renders a ReportInput into an institutional-layout PDF via headless-browser HTML-to-PDF conversion.",
  inputs: ["title", "sections[]"],
  outputs: ["filePath", "sizeBytes"],
  requiredSources: [],
  caching: false,
  estimatedRuntimeMs: 3000,
};

const REPORTS_DIR = path.resolve(process.cwd(), "reports");

export function registerGeneratePdfTool(server: FastMCP): void {
  server.addTool({
    name: "generate_pdf",
    description:
      "Renders a structured report (see generate_report's schema) into an institutional-layout PDF (headers, footers, page numbers, TOC, tables, per-section confidence, citations) via headless-browser HTML-to-PDF conversion, and writes it to the local reports directory.",
    parameters: ReportInputSchema,
    annotations: { title: "Generate PDF", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    execute: async (args) => {
      try {
        await fs.mkdir(REPORTS_DIR, { recursive: true });

        const html = toHtml(args);
        const pdfBuffer = await renderHtmlToPdf(html, {
          headerTitle: args.companyName ?? "INDUSS Research Intelligence",
        });

        const filename = `${slugify(args.title)}-${Date.now()}.pdf`;
        const filePath = path.join(REPORTS_DIR, filename);
        await fs.writeFile(filePath, pdfBuffer);

        const { citations, confidence } = summarizeReport(args);

        return buildResponse({
          success: true,
          data: { filePath, sizeBytes: pdfBuffer.length },
          citations,
          confidence,
          metadata: { pages: "computed_at_render_time" },
        });
      } catch (err) {
        return errorResponse((err as Error).message);
      }
    },
  });
}
