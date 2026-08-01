import { promises as fs } from "node:fs";
import path from "node:path";
import type { FastMCP } from "fastmcp";
import { toHtml, summarizeReport } from "../../core/reports/reportEngine.js";
import { renderHtmlToPdf } from "../../core/pdf/pdfEngine.js";
import { ReportInputSchema } from "../../types/schemas.js";
import { slugify } from "../../core/renderers/shared.js";
import { makeEnvelope, errorResponse } from "../../types/common.js";
import { env } from "../../config/env.js";
import { childLogger } from "../../logger.js";
import type { ToolMeta } from "../../types/toolMeta.js";

const log = childLogger("generatePdf");

export const generatePdfMeta: ToolMeta = {
  name: "generate_pdf",
  category: "export",
  description: "Renders a ReportInput into an institutional-layout PDF via headless-browser HTML-to-PDF conversion.",
  inputs: ["title", "sections[]"],
  outputs: ["filePath", "sizeBytes", "downloadUrl"],
  requiredSources: [],
  caching: false,
  estimatedRuntimeMs: 3000,
};

const REPORTS_DIR = path.resolve(process.cwd(), "reports");
const SAFE_FILENAME = /^[a-z0-9-]+\.pdf$/;

let downloadRouteRegistered = false;

/** Serves generated PDFs over HTTP so a *remote* MCP client (e.g. Claude.ai
 * connecting to the Railway deployment) has a real URL to fetch — a
 * server-local file path is meaningless to a client that isn't on the same
 * filesystem. This is a public route (no auth) since filenames are
 * effectively unguessable (slug + timestamp) and the content isn't
 * sensitive enough to justify fighting the OAuth session for a one-off
 * download link. Registered once, the first time generate_pdf is used. */
function ensureDownloadRoute(server: FastMCP): void {
  if (downloadRouteRegistered) return;
  downloadRouteRegistered = true;

  try {
    const app = server.getApp();
    app.get("/reports/:filename", async (c) => {
      const filename = c.req.param("filename");
      if (!SAFE_FILENAME.test(filename)) return c.body(null, 400);

      const filePath = path.join(REPORTS_DIR, filename);
      if (path.dirname(filePath) !== REPORTS_DIR) return c.body(null, 400);

      try {
        const buffer = await fs.readFile(filePath);
        return c.body(buffer, 200, {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${filename}"`,
        });
      } catch {
        return c.body(null, 404);
      }
    });
  } catch (err) {
    log.debug({ err }, "Could not register /reports download route (non-httpStream transport?)");
  }
}

export function registerGeneratePdfTool(server: FastMCP): void {
  ensureDownloadRoute(server);

  server.addTool({
    name: "generate_pdf",
    description:
      "Renders a structured report (see generate_report's schema) into an institutional-layout PDF (cover page, TOC, headers, footers, page numbers, tables, per-section confidence, citations) via headless-browser HTML-to-PDF conversion. Returns the PDF embedded directly in the response (as a base64 resource) so remote clients can retrieve it without filesystem access, plus a downloadUrl when running over httpStream.",
    parameters: ReportInputSchema,
    annotations: { title: "Generate PDF", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    execute: async (args) => {
      try {
        await fs.mkdir(REPORTS_DIR, { recursive: true });

        const html = toHtml(args);
        const pdfBuffer = await renderHtmlToPdf(html, {
          headerTitle: args.companyName ?? args.brandName ?? "INDUSS Research Intelligence",
        });

        const filename = `${slugify(args.title)}-${Date.now()}.pdf`;
        const filePath = path.join(REPORTS_DIR, filename);
        await fs.writeFile(filePath, pdfBuffer);

        const { citations, confidence } = summarizeReport(args);
        const downloadUrl = env.MCP_BASE_URL ? `${env.MCP_BASE_URL.replace(/\/$/, "")}/reports/${filename}` : undefined;

        const envelope = makeEnvelope({
          success: true,
          data: { filePath, sizeBytes: pdfBuffer.length, downloadUrl },
          citations,
          confidence,
          metadata: { pages: "computed_at_render_time" },
        });

        return {
          content: [
            { type: "text", text: JSON.stringify(envelope) },
            {
              type: "resource",
              resource: {
                uri: `induss-report:///${filename}`,
                mimeType: "application/pdf",
                blob: pdfBuffer.toString("base64"),
              },
            },
          ],
        };
      } catch (err) {
        return errorResponse((err as Error).message);
      }
    },
  });
}
