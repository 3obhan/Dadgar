/**
 * Cloudflare Pages Function: POST /api/deliberate
 */

function cleanSecret(val) {
  if (typeof val !== "string") return "";
  return val.trim().replace(/^["']+|["']+$/g, "").trim();
}

function getApiKey(env, request) {
  const candidates = [
    env?.GEMINI_API_KEY,
    env?.GOOGLE_API_KEY,
    env?.GOOGLE_GENERATIVE_AI_API_KEY,
    env?.API_KEY,
    env?.GEMINI_KEY,
    env?.VITE_GEMINI_API_KEY,
    env?.NEXT_PUBLIC_GEMINI_API_KEY,
    request.headers.get("x-goog-api-key"),
    request.headers.get("x-api-key"),
  ];
  for (const c of candidates) {
    const cleaned = cleanSecret(c);
    if (cleaned) return cleaned;
  }
  return "";
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Goog-Api-Key, X-Api-Key",
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Goog-Api-Key, X-Api-Key",
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json().catch(() => ({}));
    const { lang, partyA, partyB } = body;
    const isFa = lang === "fa";

    if (!partyA?.claimText || !partyA.claimText.trim()) {
      return jsonResponse(
        {
          error: {
            code: "MISSING_CLAIMS",
            message: isFa ? "شرح ادعای خواهان الزامی است." : "Party A claim statement is required.",
          },
        },
        400
      );
    }

    const partyAName = partyA.name || (isFa ? "خواهان (طرف اول)" : "Party A");
    const partyBName = partyB?.name || (isFa ? "خوانده (طرف دوم)" : "Party B");
    const partyBClaim = partyB?.claimText || "";

    const apiKey = getApiKey(env, request);
    if (!apiKey) {
      return jsonResponse(
        {
          error: {
            code: "GEMINI_API_KEY_MISSING",
            message: isFa
              ? "کلید API جمینای تنظیم نشده است. لطفاً کلید رایگان GEMINI_API_KEY را در بخش Settings > Secrets (یا متغیرهای محیطی) وارد فرمایید تا قضاوت با هوش منطقی Gemini 4 انجام شود."
              : "Gemini API key is not configured. Please set GEMINI_API_KEY in environment secrets.",
          },
        },
        503
      );
    }

    const systemInstruction = `You are Mr. Judge (آقای قاضی) — an uncompromising Supreme Rational & Mathematical Arbitrator.
Perform pure formal logic, epistemological, quantifier-scope, and empirical reality evaluation. Never issue lazy 50-50 compromise verdicts when one party is logically or factually stronger.
CRITICAL QUANTIFIER & DOMAIN-SCOPE CALCULUS:
- Universal/Absolute claim ("best in the world", "always", "never", "100%") requires universal falsifiable proof and suffers enormous falsifiability penalty if constrained or subjective.
- Scoped/Bounded claim ("best Persian-language singer", "best in X domain") is far more precise, rational, and defensible.
- When Party A makes an overbroad universal claim and Party B makes a narrower, domain-bounded claim on a comparable subject, Party B MUST win decisively on logical precision and epistemological humility.
Language for all output fields: ${isFa ? "Persian (فارسی) — formal, sharp, mathematical and logical prose" : "English"}.
Return ONLY strict JSON matching the schema.`;

    const promptText = `PLAINTIFF (${partyAName}):
Claim: ${partyA.claimText}
Evidence notes: ${partyA.evidenceNotes || "None"}

DEFENDANT (${partyBName}):
Claim: ${partyBClaim || "No formal response submitted"}
Evidence notes: ${partyB?.evidenceNotes || "None"}

Required JSON schema:
{
  "courtDecreeCode": "DGR-${Date.now().toString(36).toUpperCase()}",
  "timestamp": ${Date.now()},
  "winner": "partyA" | "partyB" | "split" | "equal",
  "partyAScore": number,
  "partyBScore": number,
  "verdictTitle": string,
  "moreRightfulPartyName": string,
  "moreRightfulPartyScore": number,
  "executiveSummary": string,
  "pureReasoning": string,
  "factualAnalysis": string,
  "realityCheck": string,
  "keyFactors": string[],
  "suggestedSettlement": string,
  "judicialMaxims": string[]
}`;

    const attempts = [
      { model: "gemini-4-hydrogen", thinkingConfig: { thinkingLevel: "XHIGH" } },
      { model: "gemini-4-hydrogen", thinkingConfig: { thinkingLevel: "HIGH" } },
      { model: "gemini-3.1-flash-lite", thinkingConfig: undefined },
    ];

    let verdictData = null;
    let lastError = "Failed to get response from Gemini";

    for (const attempt of attempts) {
      try {
        const generationConfig = { responseMimeType: "application/json" };
        if (attempt.thinkingConfig) generationConfig.thinkingConfig = attempt.thinkingConfig;

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${attempt.model}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "aistudio-build",
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemInstruction }] },
              contents: [{ parts: [{ text: promptText }] }],
              generationConfig,
            }),
          }
        );

        const data = await res.json().catch(() => null);
        if (!res.ok) {
          lastError = data?.error?.message || `HTTP ${res.status}`;
          continue;
        }
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          verdictData = JSON.parse(text);
          verdictData.meta = {
            engine: "gemini-logical-core",
            model: attempt.model,
            thinkingLevel: attempt.thinkingConfig?.thinkingLevel || "STANDARD",
          };
          break;
        }
      } catch (err) {
        lastError = err?.message || lastError;
      }
    }

    if (!verdictData) {
      return jsonResponse(
        {
          error: {
            code: "GEMINI_UNAVAILABLE",
            message: isFa
              ? `موتور هوش مصنوعی جمینای در حال حاضر پاسخگو نبود (${lastError}). لطفاً اعتبار کلید GEMINI_API_KEY و اتصال را بررسی نمایید.`
              : `Gemini AI engine unavailable (${lastError}).`,
          },
        },
        502
      );
    }

    if (!verdictData.courtDecreeCode) {
      verdictData.courtDecreeCode = `DGR-${Date.now().toString(36).toUpperCase()}`;
    }

    return jsonResponse({ verdict: verdictData });
  } catch (err) {
    return jsonResponse({ error: { message: err?.message || "Internal server error" } }, 500);
  }
}
