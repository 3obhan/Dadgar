import { CognitiveMode, getModeSpec, UNIVERSAL_COGNITIVE_AXIOMS } from "./cognitiveModes.js";
import { SymbolicVerificationResult, verifySymbolicFacts } from "./symbolicTruth.js";
import { MemoryEntry, ProjectMemoryStore } from "../memory/memoryStore.js";
import {
  extractJsonFromLlmText,
  ProviderConfig,
  ProviderKind,
  routeLlmCall,
} from "../providers/providerRouter.js";

export interface ThinkRequest {
  mode?: CognitiveMode;
  prompt?: string;
  lang?: "fa" | "en";
  projectId?: string;
  context?: string;
  deepThink?: boolean;
  rememberOutcome?: boolean;
  customSystemPrompt?: string;
  outputSchemaDescription?: string;
  partyA?: { name?: string; claimText: string; evidenceNotes?: string };
  partyB?: { name?: string; claimText: string; evidenceNotes?: string };
}

export interface ThinkResult {
  ok: true;
  mode: CognitiveMode;
  provider: ProviderKind;
  model: string;
  deepThinkUsed: boolean;
  symbolicCheck: SymbolicVerificationResult | null;
  recalledMemories: Array<{ id: string; kind: string; content: string }>;
  output: Record<string, any>;
  latencyMs: number;
}

function normalizeArbitrationOutput(
  parsed: Record<string, any>,
  partyAName: string,
  partyBName: string,
  symbolic: SymbolicVerificationResult | null,
  isFa: boolean
): Record<string, any> {
  let scoreA = symbolic?.arbitrationVerdict
    ? symbolic.arbitrationVerdict.partyAScore
    : Number(parsed?.partyAScore);
  let scoreB = symbolic?.arbitrationVerdict
    ? symbolic.arbitrationVerdict.partyBScore
    : Number(parsed?.partyBScore);

  if (!Number.isFinite(scoreA) && Number.isFinite(scoreB)) scoreA = 100 - scoreB;
  if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) {
    scoreA = 50;
    scoreB = 50;
  }
  scoreA = Math.max(0, Math.min(100, Math.round(scoreA)));
  scoreB = 100 - scoreA;
  const winner = scoreA > scoreB ? "partyA" : scoreB > scoreA ? "partyB" : "equal";

  return {
    ...parsed,
    winner,
    partyAScore: scoreA,
    partyBScore: scoreB,
    moreRightfulPartyName:
      winner === "partyA"
        ? partyAName
        : winner === "partyB"
        ? partyBName
        : isFa
        ? "تساوی منطقی ادعاها"
        : "Equal Logical Merit",
    moreRightfulPartyScore: Math.max(scoreA, scoreB),
    keyFactors: Array.isArray(parsed?.keyFactors) ? parsed.keyFactors : [],
    confidence: Math.max(0, Math.min(100, Math.round(Number(parsed?.confidence) || 80))),
  };
}

export async function runCognitivePipeline(
  req: ThinkRequest,
  memoryStore: ProjectMemoryStore,
  providerCfg: ProviderConfig = {}
): Promise<ThinkResult> {
  const started = Date.now();
  const modeSpec = getModeSpec(req.mode);
  const isFa = req.lang === "fa" || /[\u0600-\u06FF]/.test(`${req.prompt || ""} ${req.partyA?.claimText || ""}`);
  const targetLang = req.lang ? (req.lang === "fa" ? "Persian (فارسی)" : "English") : isFa ? "Persian (فارسی)" : "English";

  // Build input text
  let primaryInput = (req.prompt || "").trim();
  let secondaryInput = "";
  const partyAName = req.partyA?.name?.trim() || (isFa ? "طرف اول" : "Party A");
  const partyBName = req.partyB?.name?.trim() || (isFa ? "طرف دوم" : "Party B");

  if (modeSpec.mode === "arbitrate" && req.partyA?.claimText) {
    primaryInput = req.partyA.claimText;
    secondaryInput = req.partyB?.claimText || "";
  }

  if (!primaryInput) {
    throw new Error("Input prompt (or partyA.claimText in arbitrate mode) is required.");
  }

  // Stage 1: Deterministic Symbolic Truth Grounding
  const symbolicCheck = verifySymbolicFacts(primaryInput, secondaryInput || undefined);

  // Stage 2: Bilingual Project Memory Recall
  let recalled: MemoryEntry[] = [];
  if (req.projectId) {
    recalled = memoryStore.retrieveRelevant(req.projectId, `${primaryInput} ${secondaryInput}`, 6);
  }

  const schemaBlock = req.outputSchemaDescription?.trim() || modeSpec.jsonContract;
  const systemPrompt = [
    UNIVERSAL_COGNITIVE_AXIOMS,
    `\nACTIVE COGNITIVE MODE: ${modeSpec.title}\n${modeSpec.systemGuidance}`,
    req.customSystemPrompt ? `\nPROJECT-SPECIFIC DIRECTIVE:\n${req.customSystemPrompt.trim()}` : "",
    `\nSTRICT OUTPUT FORMAT: Respond with ONLY valid JSON matching:\n${schemaBlock}`,
  ]
    .filter(Boolean)
    .join("\n");

  const memoryBlock =
    recalled.length > 0
      ? `\nRECALLED PROJECT MEMORY (RESPECT RELEVANT RULES & FACTS):\n${recalled
          .map((m) => `- [${m.kind.toUpperCase()}] ${m.content}`)
          .join("\n")}`
      : "";

  const symbolicBlock = symbolicCheck
    ? `\nSYMBOLIC TRUTH GROUNDING (VERIFIED DETERMINISTIC FACTS — DO NOT CONTRADICT):\n${JSON.stringify(
        symbolicCheck,
        null,
        2
      )}`
    : "";

  const userTaskBlock =
    modeSpec.mode === "arbitrate" && req.partyA
      ? `PARTY A (${partyAName}):\n- Claim: ${req.partyA.claimText}\n- Evidence: ${
          req.partyA.evidenceNotes || "None"
        }\n\nPARTY B (${partyBName}):\n- Claim: ${req.partyB?.claimText || "No response"}\n- Evidence: ${
          req.partyB?.evidenceNotes || "None"
        }`
      : `USER REQUEST:\n${primaryInput}${req.context ? `\n\nADDITIONAL CONTEXT:\n${req.context}` : ""}`;

  const userPrompt = `Target Language: ${targetLang}${memoryBlock}${symbolicBlock}\n\n${userTaskBlock}\n\nReturn ONLY raw JSON.`;

  // Stage 3: Primary Deliberation
  let llmRes = await routeLlmCall(
    { systemPrompt, userPrompt, temperature: 0.15, jsonMode: true },
    providerCfg
  );
  let parsed = extractJsonFromLlmText(llmRes.rawText);

  // Stage 4: Optional Second-Pass Self-Critique Verification (deepThink)
  if (req.deepThink) {
    const critiquePrompt = `You are performing a rigorous SECOND-PASS VERIFICATION on a draft AI reasoning output.
Check for:
1. Any contradiction with SYMBOLIC TRUTH GROUNDING facts.
2. Logical fallacies, scope overreach (∀ vs ∃), hidden unstated assumptions, or diplomatic score hedging.
3. Missing edge cases or failure modes.
4. Arithmetic consistency (if partyAScore/partyBScore exist, sum MUST equal 100).

ORIGINAL REQUEST:
${userTaskBlock}
${symbolicBlock}

DRAFT JSON OUTPUT:
${JSON.stringify(parsed, null, 2)}

Produce an improved, sharper, fully corrected JSON object matching the exact same schema in ${targetLang}. Return ONLY raw JSON.`;

    const refinedRes = await routeLlmCall(
      { systemPrompt, userPrompt: critiquePrompt, temperature: 0.1, jsonMode: true },
      providerCfg
    );
    try {
      parsed = extractJsonFromLlmText(refinedRes.rawText);
      llmRes = refinedRes;
    } catch {
      // Keep validated first-pass JSON if second pass fails to parse
    }
  }

  // Stage 5: Deterministic Invariant Normalization
  const finalOutput =
    modeSpec.mode === "arbitrate"
      ? normalizeArbitrationOutput(parsed, partyAName, partyBName, symbolicCheck, isFa)
      : {
          ...parsed,
          confidence: Math.max(0, Math.min(100, Math.round(Number(parsed?.confidence) || 82))),
        };

  // Optional Automatic Memory Consolidation
  if (req.projectId && req.rememberOutcome) {
    const summaryText =
      finalOutput.answer ||
      finalOutput.executiveSummary ||
      finalOutput.summary ||
      finalOutput.coreIntuition;
    if (typeof summaryText === "string" && summaryText.trim()) {
      memoryStore.add({
        projectId: req.projectId,
        kind: "decision",
        content: `Q: ${primaryInput.slice(0, 120)} -> ${summaryText.slice(0, 260)}`,
        tags: [modeSpec.mode],
        importance: 6,
      });
    }
  }

  return {
    ok: true,
    mode: modeSpec.mode,
    provider: llmRes.provider,
    model: llmRes.model,
    deepThinkUsed: Boolean(req.deepThink),
    symbolicCheck,
    recalledMemories: recalled.map((m) => ({ id: m.id, kind: m.kind, content: m.content })),
    output: finalOutput,
    latencyMs: Date.now() - started,
  };
}
