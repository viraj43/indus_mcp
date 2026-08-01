import type { ResearchContextInput } from "../../types/context.js";
import type { ReportInput, ResearchSection, ReportTable } from "../../types/schemas.js";
import { dedupeCitations, aggregateConfidence } from "../citations/citationEngine.js";
import { labelDomains } from "../../sources/labels.js";
import { getCompanyProfile } from "../../tools/company/companyProfile.js";
import { getCompanyOverview } from "../../tools/company/companyOverview.js";
import { getFinancialStatements } from "../../tools/financial/financialStatements.js";
import { getIndustryOverview } from "../../tools/industry/industryOverview.js";
import { getDiscoverCompetitors } from "../../tools/competitor/discoverCompetitors.js";
import { getFundingHistory } from "../../tools/funding/fundingHistory.js";
import { getLitigationHistory } from "../../tools/litigation/litigationHistory.js";
import { getPromoterBackground } from "../../tools/promoter/promoterBackground.js";
import { getNegativeNews } from "../../tools/news/negativeNews.js";
import { getLatestNews } from "../../tools/news/latestNews.js";
import type { ToolResult } from "../../types/common.js";

export type InstitutionalReportType = "debt_raising" | "credit_assessment" | "equity_research" | "general_diligence";

export interface InstitutionalReportOptions {
  company: string;
  reportType: InstitutionalReportType;
  country: "india" | "global";
  listed: "listed" | "unlisted" | "unknown";
  sector?: string;
  companyDomain?: string;
}

export interface PhaseError {
  phase: string;
  message: string;
}

export interface InstitutionalReportResult {
  report: ReportInput;
  phaseErrors: PhaseError[];
}

const REPORT_TYPE_LABELS: Record<InstitutionalReportType, string> = {
  debt_raising: "Debt Raising / Credit Assessment",
  credit_assessment: "Credit Assessment",
  equity_research: "Equity Research",
  general_diligence: "Company Due Diligence",
};

function unwrap<T>(settled: PromiseSettledResult<T>, phase: string, phaseErrors: PhaseError[]): T | null {
  if (settled.status === "fulfilled") return settled.value;
  phaseErrors.push({ phase, message: settled.reason instanceof Error ? settled.reason.message : String(settled.reason) });
  return null;
}

function domainsCheckedOf(result: ToolResult<unknown> | null): string[] {
  const domains = result?.metadata.domainsChecked;
  return Array.isArray(domains) ? (domains as string[]) : [];
}

function buildCompanySnapshotSection(
  profile: ToolResult<Awaited<ReturnType<typeof getCompanyProfile>>["data"]> | null,
  overview: ToolResult<Awaited<ReturnType<typeof getCompanyOverview>>["data"]> | null,
): ResearchSection {
  const lines: string[] = [];
  if (profile) {
    lines.push(`**CIN:** ${profile.data.cin ?? "Not found in retrieved sources"}`);
    lines.push(`**Incorporation Date:** ${profile.data.incorporationDate ?? "Not found in retrieved sources"}`);
    lines.push(`**Listing Status:** ${profile.data.listingStatus}`);
  }
  if (overview?.data.summary) {
    lines.push("");
    lines.push(overview.data.summary.slice(0, 800));
  }

  const citations = dedupeCitations([...(profile?.citations ?? []), ...(overview?.citations ?? [])]);
  const needsVerification = !profile?.data.cin;

  return {
    title: "Company Snapshot",
    summary: lines.length > 0 ? lines.join("\n") : "No company profile data could be retrieved from trusted sources.",
    tables: [],
    citations,
    confidence: aggregateConfidence(citations),
    metadata: needsVerification ? { tone: "info", label: "Verification Required" } : {},
  };
}

function buildFinancialSection(financials: ToolResult<Awaited<ReturnType<typeof getFinancialStatements>>["data"]> | null): ResearchSection {
  if (!financials) {
    return {
      title: "Financial Snapshot",
      summary: "Financial data lookup failed — see report metadata for the underlying error.",
      tables: [],
      citations: [],
      confidence: 0,
      metadata: { tone: "warning", label: "Financial Data Not Available" },
    };
  }

  const d = financials.data;
  if (d.status === "not_available") {
    return {
      title: "Financial Snapshot",
      summary: `**Status:** Not Available\n\n**Reason:** ${d.reason}\n\n- Recommended sources to check manually: ${d.recommendedSources.join(", ")}`,
      tables: [],
      citations: financials.citations,
      confidence: 0,
      metadata: { tone: "warning", label: "Financial Data Not Available" },
    };
  }

  const tables: ReportTable[] = [];
  if (d.lineItems) {
    const headers = ["Line Item", ...d.periods];
    const rows = Object.entries(d.lineItems).map(([key, values]) => [
      key,
      ...values.map((v) => (v === null ? "N/A" : String(v))),
    ]);
    tables.push({ headers, rows });
  }

  return {
    title: "Financial Snapshot",
    summary: `**Extraction Method:** ${d.extractionMethod}\n**Primary Source:** ${d.primarySourceUrl}`,
    tables,
    citations: financials.citations,
    confidence: financials.confidence,
    metadata: {},
  };
}

function buildIndustrySection(industry: ToolResult<Awaited<ReturnType<typeof getIndustryOverview>>["data"]> | null): ResearchSection | null {
  if (!industry) return null;
  return {
    title: "Industry Overview",
    summary: industry.data.summary || "No industry overview found in the trusted source allowlist.",
    tables: [],
    citations: industry.citations,
    confidence: industry.confidence,
    metadata: {},
  };
}

function buildCompetitorSection(competitors: ToolResult<Awaited<ReturnType<typeof getDiscoverCompetitors>>["data"]> | null): ResearchSection {
  if (!competitors || competitors.data.topPeers.length === 0) {
    return {
      title: "Competitor Landscape",
      summary: "No named competitors could be extracted from the retrieved industry/news sources.",
      tables: [],
      citations: competitors?.citations ?? [],
      confidence: competitors?.confidence ?? 0,
      metadata: {},
    };
  }

  const table: ReportTable = {
    headers: ["Competitor", "Mentions", "Listed Signal"],
    rows: competitors.data.topPeers.map((p) => [p.name, p.mentionCount, p.listedSignal ? "Yes" : "No"]),
  };

  return {
    title: "Competitor Landscape",
    summary: `Ranked by mention frequency across industry/news sources and a listed-company signal — the server selected these peers rather than leaving the choice to the calling model. ${competitors.data.rankedCompetitors.length} candidate(s) identified in total.`,
    tables: [table],
    citations: competitors.citations,
    confidence: competitors.confidence,
    metadata: {},
  };
}

function buildFundingSection(funding: ToolResult<Awaited<ReturnType<typeof getFundingHistory>>["data"]> | null): ResearchSection | null {
  if (!funding || funding.data.events.length === 0) return null;

  const table: ReportTable = {
    headers: ["Round", "Amount", "Source"],
    rows: funding.data.events.map((e) => {
      let hostname = e.url;
      try {
        hostname = new URL(e.url).hostname;
      } catch {
        // keep raw url if unparsable
      }
      return [e.round ?? "Unspecified", e.amountRaw ?? "Not disclosed", hostname];
    }),
  };

  return {
    title: "Funding History",
    summary: `${funding.data.events.length} funding-related mention(s) found across retrieved sources.`,
    tables: [table],
    citations: funding.citations,
    confidence: funding.confidence,
    metadata: {},
  };
}

function buildRiskScreeningSection(
  litigation: ToolResult<Awaited<ReturnType<typeof getLitigationHistory>>["data"]> | null,
  promoter: ToolResult<Awaited<ReturnType<typeof getPromoterBackground>>["data"]> | null,
  negativeNews: ToolResult<Awaited<ReturnType<typeof getNegativeNews>>["data"]> | null,
): ResearchSection {
  const checkedDomains = new Set<string>();
  [litigation, promoter, negativeNews].forEach((r) => domainsCheckedOf(r).forEach((d) => checkedDomains.add(d)));
  const checklist = labelDomains(Array.from(checkedDomains))
    .map((label) => `✓ ${label}`)
    .join(", ");

  const lines: string[] = [`**Checked:** ${checklist || "no sources reachable"}`, ""];

  if (litigation) {
    lines.push(
      litigation.data.recordClean
        ? "- **Litigation / Regulatory (SEBI, NCLT, legal media):** No matches found."
        : `- **Litigation / Regulatory (SEBI, NCLT, legal media):** ${litigation.data.cases.length} potential record(s) found — requires manual review.`,
    );
    for (const c of litigation.data.cases.slice(0, 3)) {
      lines.push(`  - [${c.title}](${c.url})${c.caseReference ? ` (Case: ${c.caseReference})` : ""}`);
    }
  } else {
    lines.push("- **Litigation / Regulatory:** screen could not be completed — see report metadata for the error.");
  }

  if (promoter) {
    lines.push(
      promoter.data.screenClean
        ? "- **Promoter / Director Background:** No disqualification or debarment records found."
        : `- **Promoter / Director Background:** ${promoter.data.flags.length} flag(s) found — requires manual review.`,
    );
  } else {
    lines.push("- **Promoter / Director Background:** screen could not be completed — see report metadata for the error.");
  }

  if (negativeNews) {
    lines.push(
      negativeNews.data.screenClean
        ? "- **Adverse Media & Public Sentiment:** No adverse coverage found."
        : `- **Adverse Media & Public Sentiment:** ${negativeNews.data.flaggedArticles.length} article(s) flagged — requires manual review.`,
    );
  } else {
    lines.push("- **Adverse Media & Public Sentiment:** screen could not be completed — see report metadata for the error.");
  }

  const citations = dedupeCitations([
    ...(litigation?.citations ?? []),
    ...(promoter?.citations ?? []),
    ...(negativeNews?.citations ?? []),
  ]);

  const anyDirty = litigation?.data.recordClean === false || promoter?.data.screenClean === false || negativeNews?.data.screenClean === false;
  const allRan = litigation && promoter && negativeNews;
  const allClean = allRan && litigation.data.recordClean && promoter.data.screenClean && negativeNews.data.screenClean;

  return {
    title: "Risk & Compliance Screening",
    summary: lines.join("\n"),
    tables: [],
    citations,
    confidence: aggregateConfidence(citations),
    metadata: anyDirty
      ? { tone: "danger", label: "Risk Flags Identified" }
      : allClean
        ? { tone: "success", label: "Screening Clean" }
        : {},
  };
}

function buildNewsSection(news: ToolResult<Awaited<ReturnType<typeof getLatestNews>>["data"]> | null): ResearchSection | null {
  if (!news) return null;
  const lines = news.data.articles
    .slice(0, 5)
    .map((a) => `- [${a.title}](${a.url})${a.publishedDate ? ` — ${a.publishedDate.slice(0, 10)}` : ""}`);

  return {
    title: "Recent News",
    summary: lines.length > 0 ? lines.join("\n") : "No recent news coverage found in the trusted source allowlist.",
    tables: [],
    citations: news.citations,
    confidence: news.confidence,
    metadata: {},
  };
}

/** The internal orchestrator behind generate_institutional_report:
 * one call in, every relevant phase run in parallel (Router → Exa →
 * Extractor → Validator → Citation Engine for each), composed into
 * ResearchSections with deterministic templated text — no LLM tokens spent
 * inside the server. The calling model receives a finished report instead
 * of having to plan and narrate 10 separate tool calls itself. */
export async function buildInstitutionalReport(opts: InstitutionalReportOptions): Promise<InstitutionalReportResult> {
  const baseContext: ResearchContextInput = {
    company: opts.company,
    companyDomain: opts.companyDomain,
    sector: opts.sector,
    country: opts.country,
    listed: opts.listed,
    date: new Date().toISOString(),
  };

  const phaseErrors: PhaseError[] = [];

  const [
    profileSettled,
    overviewSettled,
    financialsSettled,
    industrySettled,
    competitorsSettled,
    fundingSettled,
    litigationSettled,
    promoterSettled,
    negativeNewsSettled,
    newsSettled,
  ] = await Promise.allSettled([
    getCompanyProfile(baseContext),
    getCompanyOverview(baseContext),
    getFinancialStatements(baseContext),
    opts.sector ? getIndustryOverview(baseContext) : Promise.resolve(null),
    getDiscoverCompetitors(baseContext),
    getFundingHistory(baseContext),
    getLitigationHistory(baseContext),
    getPromoterBackground(baseContext),
    getNegativeNews(baseContext),
    getLatestNews(baseContext, 180),
  ]);

  const profile = unwrap(profileSettled, "company_profile", phaseErrors);
  const overview = unwrap(overviewSettled, "company_overview", phaseErrors);
  const financials = unwrap(financialsSettled, "financial_statements", phaseErrors);
  const industry = unwrap(industrySettled, "industry_overview", phaseErrors);
  const competitors = unwrap(competitorsSettled, "discover_competitors", phaseErrors);
  const funding = unwrap(fundingSettled, "funding_history", phaseErrors);
  const litigation = unwrap(litigationSettled, "litigation_history", phaseErrors);
  const promoter = unwrap(promoterSettled, "promoter_background", phaseErrors);
  const negativeNews = unwrap(negativeNewsSettled, "negative_news", phaseErrors);
  const news = unwrap(newsSettled, "latest_news", phaseErrors);

  const sections: ResearchSection[] = [
    buildCompanySnapshotSection(profile, overview),
    buildFinancialSection(financials),
    buildIndustrySection(industry),
    buildCompetitorSection(competitors),
    buildFundingSection(funding),
    buildRiskScreeningSection(litigation, promoter, negativeNews),
    buildNewsSection(news),
  ].filter((s): s is ResearchSection => s !== null);

  const report: ReportInput = {
    title: `${opts.company} — ${REPORT_TYPE_LABELS[opts.reportType]}`,
    subtitle: "Company Diligence & Market Intelligence Brief",
    companyName: opts.company,
    tags: [opts.listed === "listed" ? "Listed" : opts.listed === "unlisted" ? "Unlisted" : "Listing Status Unknown", REPORT_TYPE_LABELS[opts.reportType]],
    preparedBy: "INDUSS Research Intelligence Agent",
    sections,
  };

  return { report, phaseErrors };
}
