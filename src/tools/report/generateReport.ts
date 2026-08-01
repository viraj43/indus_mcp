import type { FastMCP } from "fastmcp";
import { toJson, summarizeReport } from "../../core/reports/reportEngine.js";
import { ReportInputSchema } from "../../types/schemas.js";
import { buildResponse, errorResponse } from "../../types/common.js";
import type { ToolMeta } from "../../types/toolMeta.js";

export const generateReportMeta: ToolMeta = {
  name: "generate_report",
  category: "report",
  description: "Assembles ResearchSections into the standard report envelope. Does no research of its own.",
  inputs: ["title", "sections[]"],
  outputs: ["report"],
  requiredSources: [],
  caching: false,
  estimatedRuntimeMs: 20,
};

export function registerGenerateReportTool(server: FastMCP): void {
  server.addTool({
    name: "generate_report",
    description:
      "Assembles a structured research report from ResearchSections (each carrying its own summary, tables, citations, and confidence) into the standard report envelope. Use after gathering facts with other tools; this tool does no research of its own.",
    parameters: ReportInputSchema,
    annotations: { title: "Generate Report", readOnlyHint: false, openWorldHint: false, idempotentHint: true },
    execute: async (args) => {
      try {
        const report = toJson(args);
        const { citations, confidence } = summarizeReport(report);
        return buildResponse({
          success: true,
          data: report,
          citations,
          confidence,
          metadata: { sectionCount: report.sections.length },
        });
      } catch (err) {
        return errorResponse((err as Error).message);
      }
    },
  });
}
