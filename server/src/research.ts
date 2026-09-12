import { HttpProblem } from "./errors.js";

export const EXA_ONBOARDING_URL = "https://dashboard.exa.ai/onboarding";

export interface EvidenceRequest {
  query: string;
  depth: "fast" | "deep";
}

export interface EvidenceSource {
  title: string;
  url: string;
  publishedAt?: string;
  highlight?: string;
}

export interface EvidenceResult {
  sources: EvidenceSource[];
  summary?: string;
}

export interface EvidenceSearch {
  search(request: EvidenceRequest): Promise<EvidenceResult>;
}

/**
 * This preserves the API contract while the Exa Dashboard generates the
 * stack-specific integration. It intentionally makes no network call and
 * never falls back to a generic search engine.
 */
export class ExaOnboardingRequiredSearch implements EvidenceSearch {
  async search(): Promise<EvidenceResult> {
    throw new HttpProblem(
      503,
      "exa_onboarding_required",
      `External evidence is not configured. Generate the Exa integration at ${EXA_ONBOARDING_URL}.`,
    );
  }
}
