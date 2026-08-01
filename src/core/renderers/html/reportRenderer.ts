import type { ReportInput } from "../../../types/schemas.js";
import { flattenSectionCitations } from "../../citations/citationEngine.js";
import { escapeHtml, slugify } from "../shared.js";

/** Pure HTML renderer for a ReportInput built from ResearchSections:
 * institutional-style cover header, TOC, sectioned body (each with its own
 * confidence badge, tables, and inline source list), and a consolidated
 * citations appendix. This is what core/pdf/pdfEngine.ts feeds to
 * Playwright for print rendering. No orchestration logic lives here — see
 * core/reports/reportEngine.ts. */
export function renderReportHtml(report: ReportInput): string {
  const generatedAt = report.generatedAt ?? new Date().toISOString();

  const toc = report.sections
    .map((s) => `<li><a href="#${slugify(s.title)}">${escapeHtml(s.title)}</a></li>`)
    .join("\n");

  const body = report.sections
    .map((section) => {
      const tablesHtml = section.tables
        .map(
          (table) => `<table class="data-table">
            <thead><tr>${table.headers.map((h) => `<th>${escapeHtml(String(h))}</th>`).join("")}</tr></thead>
            <tbody>${table.rows
              .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join("")}</tr>`)
              .join("\n")}</tbody>
          </table>`,
        )
        .join("\n");

      const sourcesHtml = section.citations.length
        ? `<p class="sources">Sources: ${section.citations
            .map((c) => `<a href="${c.url}">${escapeHtml(c.source)}</a>`)
            .join(", ")}</p>`
        : "";

      const summaryHtml = `<p>${escapeHtml(section.summary).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br/>")}</p>`;

      return `<section id="${slugify(section.title)}">
        <h2>${escapeHtml(section.title)} <span class="confidence-badge">confidence: ${section.confidence}</span></h2>
        ${summaryHtml}
        ${tablesHtml}
        ${sourcesHtml}
      </section>`;
    })
    .join("\n");

  const allCitations = flattenSectionCitations(report.sections.map((s) => s.citations));
  const citationsHtml = allCitations.length
    ? `<section id="citations">
        <h2>Citations</h2>
        <ol class="citations">
          ${allCitations
            .map(
              (c) =>
                `<li><a href="${c.url}">${escapeHtml(c.source)}</a>${
                  c.publicationDate ? ` — ${c.publicationDate}` : ""
                } <span class="confidence">tier: ${c.tier}, confidence: ${c.confidenceScore}</span></li>`,
            )
            .join("\n")}
        </ol>
      </section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(report.title)}</title>
<style>
  :root { --ink: #1a1a2e; --muted: #5c6470; --accent: #0f4c81; --border: #d7dce2; }
  * { box-sizing: border-box; }
  body { font-family: "Georgia", "Times New Roman", serif; color: var(--ink); margin: 0; padding: 40px 56px; line-height: 1.55; }
  h1 { font-size: 26px; margin-bottom: 4px; color: var(--accent); }
  h2 { font-size: 18px; margin-top: 32px; border-bottom: 2px solid var(--border); padding-bottom: 6px; color: var(--accent); display: flex; justify-content: space-between; align-items: baseline; }
  .confidence-badge { font-size: 11px; color: var(--muted); font-weight: normal; border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px; }
  .subtitle { color: var(--muted); font-style: italic; margin: 0 0 12px; }
  .meta { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
  nav.toc { background: #f4f6f8; border: 1px solid var(--border); border-radius: 6px; padding: 16px 24px; margin: 24px 0; }
  nav.toc ul { margin: 0; padding-left: 20px; }
  table.data-table { border-collapse: collapse; width: 100%; margin: 12px 0 24px; font-size: 13px; }
  table.data-table th, table.data-table td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
  table.data-table th { background: #eef2f6; }
  p.sources { font-size: 12px; color: var(--muted); }
  ol.citations { font-size: 12px; color: var(--muted); padding-left: 20px; }
  .confidence { color: #8a8fa3; }
  @media print {
    body { padding: 0 24px; }
    section { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>${escapeHtml(report.title)}</h1>
  ${report.subtitle ? `<p class="subtitle">${escapeHtml(report.subtitle)}</p>` : ""}
  <p class="meta">${report.companyName ? `Company: ${escapeHtml(report.companyName)} &middot; ` : ""}Generated: ${escapeHtml(generatedAt)}</p>
  <nav class="toc"><strong>Contents</strong><ul>${toc}</ul></nav>
  ${body}
  ${citationsHtml}
</body>
</html>`;
}
