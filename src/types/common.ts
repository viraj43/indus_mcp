import type { SourceTier } from "../sources/types.js";

/** Every MCP tool in this server returns this envelope, per the response
 * contract in the project spec: success flag, payload, citations, an
 * aggregate confidence score, and free-form metadata. */
export interface ToolResponse<T> {
  success: boolean;
  data: T | null;
  citations: Citation[];
  confidence: number;
  metadata: Record<string, unknown>;
  error?: string;
}

/** Every citation carries the four components the Source Priority Engine
 * scores it on: Tier (where the source sits in the trust hierarchy),
 * Authority (the source's baseline trust score), Recency (a penalty for
 * stale documents), and the resulting combined Confidence. */
export interface Citation {
  source: string;
  url: string;
  publicationDate: string | null;
  evidenceSnippet: string;
  tier: SourceTier;
  authority: number;
  recencyPenalty: number;
  confidenceScore: number;
}

export interface ExaSearchResultItem {
  url: string;
  title: string;
  publishedDate: string | null;
  author: string | null;
  text: string;
  score: number;
}

function makeEnvelope<T>(params: {
  success: boolean;
  data: T | null;
  citations?: Citation[];
  confidence?: number;
  metadata?: Record<string, unknown>;
  error?: string;
}): ToolResponse<T> {
  return {
    success: params.success,
    data: params.data,
    citations: params.citations ?? [],
    confidence: params.confidence ?? 0,
    metadata: params.metadata ?? {},
    ...(params.error ? { error: params.error } : {}),
  };
}

/** Builds the standard tool response envelope and serializes it to JSON
 * text — the shape FastMCP's `execute` return type requires — so every
 * tool can just `return buildResponse({...})` directly. */
export function buildResponse<T>(params: {
  success: boolean;
  data: T | null;
  citations?: Citation[];
  confidence?: number;
  metadata?: Record<string, unknown>;
  error?: string;
}): string {
  return JSON.stringify(makeEnvelope(params));
}

export function errorResponse(message: string, metadata: Record<string, unknown> = {}): string {
  return JSON.stringify(makeEnvelope<null>({ success: false, data: null, confidence: 0, metadata, error: message }));
}
