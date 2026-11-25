import { Type } from "@google/genai";

export interface DeliberationPartyInput {
  name?: string;
  claimText: string;
  evidenceNotes?: string;
  evidenceFiles?: Array<{ name?: string }>;
  audioBase64?: string;
}

export const DELIBERATION_SYSTEM_INSTRUCTION = `You are "Mr. Judge" (آقای قاضی), an uncompromising, strictly mathematical and logical AI arbitrator governed exclusively by pure reason, set-theoretic precision, deductive logic, empirical science, chronology, and objective evidence.

MANDATORY JUDICIAL AXIOMS (PURE MATHEMATICAL REASON):
1. ZERO DIPLOMATIC 50/50 SPLITS ON ASYMMETRIC LOGIC:
   - Never issue a 50/50 tie merely to sound polite or neutral when one party's statement is logically sharper, better bounded, or more defensible than the other's.
   - Return 50/50 ("equal") ONLY when both claims are genuinely identical in logical scope, precision, truth-value, and evidentiary support.

2. QUANTIFIER SCOPE & EPISTEMIC PRECISION CALCULUS (∀ vs ∃ / BOUNDED vs UNBOUNDED):
   - In pure logic and probability theory, an unbounded universal superlative over an unrestricted domain (e.g., "X is the best in the entire world" across all eras, languages, genres, and ~8 billion humans) requires vastly stronger, practically unattainable universal proof and suffers extreme epistemic overreach compared to a narrower, domain-qualified claim (e.g., "Y is the best among Persian-language singers").
   - Formally: when two competing claims lack exhaustive quantitative proof and differ in quantifier scope (Global/Absolute Unbounded vs. Local/Domain-Bounded), the narrower, more precise, bounded, and rationally defensible claim ALWAYS wins decisively (for example: 75–85 vs 15–25) because overclaiming without universal evidence is a logical fallacy of scope.
   - Explicitly explain the set-theory / domain-scope comparison in pureReasoning and factualAnalysis.

3. EMPIRICAL, MATHEMATICAL & FACTUAL SUPREMACY:
   - Any claim contradicting arithmetic, physics, astronomy, calendar chronology, verified geography, or orthographic reality scores 0, while the factually accurate claim scores 100.
   - If a FACTUAL CHECK RESULT is provided, you MUST honor its exact logical outcome.

4. UNIVERSAL EVIDENTIARY & CAUSAL INVARIANTS (SHARED ACROSS ALL CULTURES):
   - Concrete, observable proofs (receipts, signed agreements, timestamps, bank traces, attached files/voice records) outweigh bare unverified assertions across all human societies.
   - Do NOT rely on region-specific, religious, or jurisdiction-bound legal codes; ground every verdict exclusively in universal physical reality, logic, direct causality, proportional accountability, explicit mutual consent, and observable evidence.
   - Silence or failure of the Defendant to submit a substantive rebuttal shifts weight proportionally to the Claimant's coherently supported claim.

5. STRICT ARITHMETIC CONSISTENCY:
   - partyAScore and partyBScore MUST be integers between 0 and 100 with partyAScore + partyBScore = 100.
   - winner MUST strictly match scores: "partyA" if partyAScore > partyBScore, "partyB" if partyBScore > partyAScore, or "equal" only if partyAScore === 50 && partyBScore === 50.
   - moreRightfulPartyName MUST match the winning party's exact name (or balanced label only if strictly equal).
   - Write all narrative fields fluently and authoritatively in the requested Language (Persian if "Persian (فارسی)", English if "English").`;

export const DELIBERATION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    winner: {
      type: Type.STRING,
      description: 'Must be "partyA", "partyB", or "equal". Use "split" only for near-50 financial apportionment.',
    },
    partyAScore: {
      type: Type.INTEGER,
      description: "Integer score from 0 to 100 for Party A. Must satisfy partyAScore + partyBScore === 100.",
    },
    partyBScore: {
      type: Type.INTEGER,
      description: "Integer score from 0 to 100 for Party B. Must satisfy partyAScore + partyBScore === 100.",
    },
    verdictTitle: { type: Type.STRING },
    moreRightfulPartyName: { type: Type.STRING },
    moreRightfulPartyScore: { type: Type.INTEGER },
    executiveSummary: { type: Type.STRING },
    pureReasoning: { type: Type.STRING },
    factualAnalysis: { type: Type.STRING },
    realityCheck: { type: Type.STRING },
    keyFactors: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    suggestedSettlement: { type: Type.STRING },
    judicialMaxims: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: [
    "winner",
    "partyAScore",
    "partyBScore",
    "verdictTitle",
    "moreRightfulPartyName",
    "moreRightfulPartyScore",
    "executiveSummary",
    "pureReasoning",
    "factualAnalysis",
    "realityCheck",
    "keyFactors",
    "suggestedSettlement",
    "judicialMaxims",
  ],
};

export function buildDeliberationPrompt(opts: {
  isFa: boolean;
  partyAName: string;
  partyBName: string;
  partyA: DeliberationPartyInput;
  partyB?: DeliberationPartyInput;
  factualCheck: any;
}): string {
  const { isFa, partyAName, partyBName, partyA, partyB, factualCheck } = opts;
  const filesACount = Array.isArray(partyA?.evidenceFiles) ? partyA.evidenceFiles.length : 0;
  const filesBCount = Array.isArray(partyB?.evidenceFiles) ? partyB.evidenceFiles.length : 0;

  return `Analyze and adjudicate the following dispute strictly under your Mandatory Judicial Axioms.

Target Output Language: ${isFa ? "Persian (فارسی)" : "English"}

PLAINTIFF (${partyAName}):
- Claim: ${partyA.claimText}
- Evidence notes: ${partyA.evidenceNotes || "None"}
- Attached documents count: ${filesACount}${partyA.audioBase64 ? " (+ voice memo attached)" : ""}

DEFENDANT (${partyBName}):
- Claim: ${partyB?.claimText || "No formal response submitted"}
- Evidence notes: ${partyB?.evidenceNotes || "None"}
- Attached documents count: ${filesBCount}${partyB?.audioBase64 ? " (+ voice memo attached)" : ""}

${factualCheck ? `DETERMINISTIC FACTUAL CHECK VERDICT (MUST RESPECT):\n${JSON.stringify(factualCheck)}` : "No deterministic math/science rule triggered; apply pure logical, epistemic scope, reality, and evidentiary calculus."}

Ensure partyAScore + partyBScore === 100 and winner accurately reflects which side's proposition is logically, factually, or evidentially superior.`;
}

export function normalizeDeliberationVerdict(
  raw: any,
  partyAName: string,
  partyBName: string,
  modelUsed: string,
  isFa: boolean
) {
  let scoreA = Number(raw?.partyAScore);
  let scoreB = Number(raw?.partyBScore);

  if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) {
    scoreA = 50;
    scoreB = 50;
  }
  scoreA = Math.max(0, Math.min(100, Math.round(scoreA)));
  scoreB = 100 - scoreA;

  let winner: "partyA" | "partyB" | "split" | "equal" = "equal";
  if (scoreA > scoreB) {
    winner = "partyA";
  } else if (scoreB > scoreA) {
    winner = "partyB";
  } else if (raw?.winner === "split") {
    winner = "split";
  }

  const rightfulName =
    winner === "partyA"
      ? partyAName
      : winner === "partyB"
      ? partyBName
      : raw?.moreRightfulPartyName || (isFa ? "تساوی منطقی ادعاها" : "Equal Logical Merit");

  return {
    ...raw,
    courtDecreeCode: raw?.courtDecreeCode || `DGR-${Date.now().toString(36).toUpperCase()}`,
    timestamp: raw?.timestamp || Date.now(),
    winner,
    partyAScore: scoreA,
    partyBScore: scoreB,
    moreRightfulPartyName: rightfulName,
    moreRightfulPartyScore: Math.max(scoreA, scoreB),
    keyFactors: Array.isArray(raw?.keyFactors) ? raw.keyFactors : [],
    judicialMaxims: Array.isArray(raw?.judicialMaxims) ? raw.judicialMaxims : [],
    meta: {
      ...(raw?.meta || {}),
      model: modelUsed,
      engine: "gemini-pure-reason",
    },
    disclaimer: isFa
      ? "سلب مسئولیت قانونی: این نظر خروجی پردازش هوش مصنوعی بر پایه منطق محض و عقل سلیم بوده، فاقد الزام حقوقی و قضایی رسمی است و مشاوره حقوقی محسوب نمی‌شود."
      : "Disclaimer: This analysis is an AI-generated assessment based on pure logic and reason, non-binding, and does not constitute formal legal advice.",
  };
}

function extractReadableErrorText(err: any): string {
  const raw = String(err?.message || err || "").trim();
  if (!raw) return "";
  try {
    const jsonStart = raw.indexOf("{");
    if (jsonStart !== -1) {
      const parsed = JSON.parse(raw.slice(jsonStart));
      const innerMsg = parsed?.error?.message || parsed?.message;
      if (typeof innerMsg === "string" && innerMsg.trim()) {
        return innerMsg.trim();
      }
    }
  } catch (_) {}
  return raw;
}

export function isNonRetryableGeminiError(err: any): boolean {
  const status = Number(err?.status || err?.code);
  const lower = String(err?.message || err || "").toLowerCase();
  if (
    status === 401 ||
    status === 403 ||
    lower.includes("permission_denied") ||
    lower.includes("api_key_invalid") ||
    lower.includes("api key not valid")
  ) {
    return true;
  }
  return false;
}

export function isTransientGeminiError(err: any): boolean {
  if (isNonRetryableGeminiError(err)) return false;
  const status = Number(err?.status);
  const lower = String(err?.message || err || "").toLowerCase();
  return (
    status === 503 ||
    status === 502 ||
    status === 504 ||
    status === 429 ||
    lower.includes("503") ||
    lower.includes("unavailable") ||
    lower.includes("high demand") ||
    lower.includes("overloaded") ||
    lower.includes("resource_exhausted") ||
    lower.includes("quota") ||
    lower.includes("timeout") ||
    lower.includes("econnreset") ||
    lower.includes("fetch failed")
  );
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function classifyGeminiError(err: any, isFa: boolean): { status: number; code: string; message: string } {
  const readableMsg = extractReadableErrorText(err);
  const lower = `${String(err?.message || err || "")} ${readableMsg}`.toLowerCase();
  const status = Number(err?.status);

  if (
    status === 403 ||
    status === 401 ||
    lower.includes("permission_denied") ||
    lower.includes("api_key_invalid") ||
    lower.includes("api key not valid")
  ) {
    return {
      status: 403,
      code: "GEMINI_API_KEY_INVALID",
      message: isFa
        ? "کلید API جمینای نامعتبر است یا دسترسی ندارد. لطفاً کلید معتبر را در بخش Settings > Secrets (یا متغیر GEMINI_API_KEY در ورسل) بررسی و تنظیم فرمایید."
        : "Gemini API key is invalid or lacks permission. Please verify GEMINI_API_KEY in Settings > Secrets.",
    };
  }

  if (
    status === 503 ||
    lower.includes("503") ||
    lower.includes("high demand") ||
    lower.includes("unavailable") ||
    lower.includes("overloaded") ||
    lower.includes("spikes in demand")
  ) {
    return {
      status: 503,
      code: "GEMINI_HIGH_DEMAND",
      message: isFa
        ? "سرورهای مدل هوش مصنوعی Gemini در این لحظه با ترافیک بسیار بالا (خطای موقت ۵۰۳) مواجه هستند و با وجود چند بار تلاش خودکار، هنوز پاسخگو نیستند. لطفاً چند ثانیه دیگر دکمه «تلاش مجدد» را بزنید."
        : "Gemini AI servers are temporarily experiencing high demand (503). Multiple automatic retries did not clear the spike. Please wait a few seconds and click Try Again.",
    };
  }

  if (status === 429 || lower.includes("resource_exhausted") || lower.includes("quota")) {
    return {
      status: 429,
      code: "GEMINI_QUOTA_EXCEEDED",
      message: isFa
        ? "سقف درخواست‌های رایگان مدل Gemini موقتاً پر شده است (کد ۴۲۹). لطفاً چند لحظه بعد دوباره تلاش فرمایید یا کلید دارای سهمیه بالاتر در Settings > Secrets قرار دهید."
        : "Gemini free-tier quota temporarily exceeded (429). Please try again shortly.",
    };
  }

  if (lower.includes("timeout") || status === 504) {
    return {
      status: 504,
      code: "GEMINI_TIMEOUT",
      message: isFa
        ? "زمان انتظار برای دریافت پاسخ از موتور استدلالی Gemini به پایان رسید. لطفاً دوباره تلاش فرمایید."
        : "Timed out waiting for Gemini reasoning engine response. Please try again.",
    };
  }

  if (status === 404 || lower.includes("not_found")) {
    return {
      status: 502,
      code: "GEMINI_MODEL_NOT_FOUND",
      message: isFa
        ? "مدل هوش مصنوعی درخواستی در دسترس نیست (۴۰۴). لطفاً دقایقی دیگر تلاش فرمایید."
        : "Requested Gemini model was not found (404).",
    };
  }

  const cleanSnippet = readableMsg.slice(0, 140) || "Upstream Error";
  return {
    status: 502,
    code: "GEMINI_UPSTREAM_ERROR",
    message: isFa
      ? `خطا در ارتباط با موتور استدلالی Gemini (${cleanSnippet}). لطفاً دوباره تلاش فرمایید.`
      : `Failed to obtain judgment from Gemini reasoning engine (${cleanSnippet}).`,
  };
}

