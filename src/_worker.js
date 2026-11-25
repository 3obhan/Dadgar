/**
 * Cloudflare Pages Advanced Mode _worker.js
 * Handles API routes (/api/deliberate, /api/transcribe, /api/cases, /api/payments)
 * and falls back to static assets (env.ASSETS) for all other requests.
 */

const casesStore = new Map();

function getApiKey(env, request) {
  return (
    env?.GEMINI_API_KEY ||
    request.headers.get("x-goog-api-key") ||
    request.headers.get("x-api-key") ||
    ""
  );
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Goog-Api-Key, X-Api-Key",
    },
  });
}

function handleCors() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Goog-Api-Key, X-Api-Key",
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") {
      return handleCors();
    }

    // 1. /api/deliberate
    if (pathname === "/api/deliberate" && method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        const { lang, partyA, partyB } = body;
        const isFa = lang === "fa";

        if (!partyA?.claimText || !partyA.claimText.trim()) {
          return jsonResponse({
            error: {
              code: "MISSING_CLAIMS",
              message: isFa ? "شرح ادعای خواهان الزامی است." : "Party A claim is required.",
            },
          }, 400);
        }

        const apiKey = getApiKey(env, request);
        if (!apiKey) {
          return jsonResponse({
            error: {
              code: "GEMINI_API_KEY_MISSING",
              message: isFa
                ? "کلید سرور جمینای تنظیم نشده است. لطفاً GEMINI_API_KEY را در تنظیمات سرور (Settings > Secrets یا Environment Variables) قرار دهید."
                : "Server GEMINI_API_KEY is not configured in Settings > Secrets.",
              retryable: true,
            },
          }, 503);
        }

        const partyAName = (partyA.name || "").trim() || (isFa ? "خواهان (طرف اول)" : "Party A");
        const partyBName = (partyB?.name || "").trim() || (isFa ? "خوانده (طرف دوم)" : "Party B");
        const partyBClaim = partyB?.claimText || "";

        const systemInstruction = `You are "Mr. Judge" (آقای قاضی), an uncompromising, strictly mathematical and logical AI arbitrator governed exclusively by pure reason, set-theoretic precision, deductive logic, empirical science, chronology, and objective evidence.
1. ZERO DIPLOMATIC 50/50 SPLITS ON ASYMMETRIC LOGIC: Return 50/50 ("equal") ONLY when both claims are genuinely identical in logical scope, precision, truth-value, and evidentiary support.
2. QUANTIFIER SCOPE & EPISTEMIC PRECISION CALCULUS: When two competing claims lack exhaustive quantitative proof and differ in quantifier scope (e.g., Global/Unbounded "best in the world" vs. Local/Domain-Bounded "best Persian singer"), the narrower, better-bounded, rationally defensible claim ALWAYS wins decisively (e.g. 75-85 vs 15-25).
3. EMPIRICAL & MATHEMATICAL SUPREMACY: Any claim contradicting arithmetic, physics, calendar chronology, or verified geography scores 0 vs 100.
4. STRICT ARITHMETIC CONSISTENCY: partyAScore + partyBScore = 100, winner strictly matches scores, and write all prose in ${isFa ? "Persian (فارسی)" : "English"}.`;

        const promptText = `Target Language: ${isFa ? "Persian (فارسی)" : "English"}

PLAINTIFF (${partyAName}):
- Claim: ${partyA.claimText}
- Evidence: ${partyA.evidenceNotes || "None"}

DEFENDANT (${partyBName}):
- Claim: ${partyBClaim || "No formal response submitted"}
- Evidence: ${partyB?.evidenceNotes || "None"}

Return ONLY valid JSON with keys: winner ("partyA"|"partyB"|"equal"|"split"), partyAScore (integer), partyBScore (integer, sum 100), verdictTitle, moreRightfulPartyName, moreRightfulPartyScore, executiveSummary, pureReasoning, factualAnalysis, realityCheck, keyFactors (string[]), suggestedSettlement, judicialMaxims (string[]).`;

        let verdictData = null;
        let lastErrStatus = 502;
        let lastErrMsg = "AI Upstream Error";

        const attempts = [
          { model: "gemini-4-hydrogen", thinkingLevel: "XHIGH", label: "gemini-4-hydrogen (XHIGH)" },
          { model: "gemini-4-hydrogen", thinkingLevel: "HIGH", label: "gemini-4-hydrogen (HIGH)" },
          { model: "gemini-3.1-flash-lite", thinkingLevel: null, label: "gemini-3.1-flash-lite" },
        ];

        for (const attempt of attempts) {
          try {
            const genConfig = attempt.thinkingLevel
              ? { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: attempt.thinkingLevel } }
              : { responseMimeType: "application/json" };
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
                  generationConfig: genConfig,
                }),
              }
            );

            const data = await res.json().catch(() => null);
            if (!res.ok) {
              lastErrStatus = res.status;
              lastErrMsg = data?.error?.message || `HTTP ${res.status}`;
              continue;
            }
            const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p?.text || "").join("").trim();
            const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
            if (cleaned) {
              const parsed = JSON.parse(cleaned);
              const scoreA = Math.max(0, Math.min(100, Math.round(Number(parsed.partyAScore) ?? 50)));
              const scoreB = 100 - scoreA;
              const winner = scoreA > scoreB ? "partyA" : scoreB > scoreA ? "partyB" : "equal";
              verdictData = {
                ...parsed,
                courtDecreeCode: parsed.courtDecreeCode || `DGR-${Date.now().toString(36).toUpperCase()}`,
                timestamp: parsed.timestamp || Date.now(),
                partyAScore: scoreA,
                partyBScore: scoreB,
                winner,
                moreRightfulPartyName: winner === "partyA" ? partyAName : winner === "partyB" ? partyBName : (parsed.moreRightfulPartyName || partyAName),
                moreRightfulPartyScore: Math.max(scoreA, scoreB),
                meta: { model: attempt.label, engine: "gemini-pure-reason" },
              };
              break;
            }
          } catch (e) {
            lastErrMsg = e?.message || lastErrMsg;
          }
        }

        if (!verdictData) {
          return jsonResponse({
            error: {
              code: lastErrStatus === 403 || lastErrStatus === 400 ? "GEMINI_API_KEY_INVALID" : "GEMINI_UPSTREAM_ERROR",
              message: isFa
                ? `خطا در موتور استدلالی جمینای (${lastErrMsg}). لطفاً کلید سرور GEMINI_API_KEY را در Settings > Secrets بررسی فرمایید.`
                : `Gemini engine error (${lastErrMsg}).`,
            },
          }, lastErrStatus >= 400 ? lastErrStatus : 502);
        }

        return jsonResponse({ verdict: verdictData });
      } catch (err) {
        return jsonResponse({ error: { message: err?.message || "Internal server error" } }, 500);
      }
    }

    // 2. /api/transcribe
    if (pathname === "/api/transcribe" && method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        const { audioBase64, mimeType, lang } = body;
        const isFa = lang === "fa";

        if (!audioBase64) {
          return jsonResponse({ error: { message: "Missing audio data" } }, 400);
        }

        const cleanBase64 = audioBase64.includes(",") ? audioBase64.split(",")[1] : audioBase64.trim();
        if (cleanBase64.length < 50) {
          return jsonResponse({
            transcription: "",
            noSpeechDetected: true,
            success: false,
            message: isFa ? "فایل ضبط‌شده خالی است." : "Recording was empty.",
          }, 200);
        }

        const apiKey = getApiKey(env, request);
        let transcriptionText = "";

        if (apiKey) {
          let audioMime = mimeType ? mimeType.split(";")[0].trim().toLowerCase() : "audio/webm";
          if (cleanBase64.startsWith("UklGR")) audioMime = "audio/wav";
          else if (cleanBase64.startsWith("GkXf")) audioMime = "audio/webm";

          const promptText = isFa
            ? "این یک فایل صوتی ادعای حقوقی یا اظهارات طرف دعوی است. لطفاً تمامی صحبت‌های گوینده را با دقت کامل، کلمه به کلمه و با رسم‌الخط صحیح فارسی بنویسید. فقط متن صریح و دقیق پیاده‌شده را برگردانید و هیچ توضیح اضافه یا علامتی نیاورید."
            : "Transcribe the spoken audio verbatim into clear plain text without any preamble or commentary.";

          const models = ["gemini-3.5-transcribe", "gemini-3.8-flash", "gemini-flash-latest"];

          for (const model of models) {
            try {
              const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "aistudio-build",
                  },
                  body: JSON.stringify({
                    contents: [
                      {
                        parts: [
                          { inlineData: { mimeType: audioMime, data: cleanBase64 } },
                          { text: promptText },
                        ],
                      },
                    ],
                  }),
                }
              );

              const data = await res.json().catch(() => null);
              const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text && text.trim().length > 0) {
                transcriptionText = text.trim();
                break;
              }
            } catch (_) {}
          }
        }

        if (transcriptionText) {
          const cleanText = transcriptionText.replace(/^["'«»“]+|["'«»”]+$/g, "").trim();
          return jsonResponse({
            transcription: cleanText,
            audioAttached: true,
            success: true,
          });
        }

        return jsonResponse({
          transcription: "",
          audioAttached: true,
          success: false,
          requiresApiKey: !apiKey,
          message: isFa
            ? "فایل صوتی ذخیره شد. برای پیاده‌سازی خودکار متن، لطفاً کلید API را در تنظیمات تنظیم فرمایید."
            : "Audio stored. Configure API key for automated transcription.",
        }, 200);
      } catch (err) {
        return jsonResponse({ error: { message: err?.message || "Transcription error" } }, 500);
      }
    }

    // 3. /api/cases
    if (pathname === "/api/cases" && method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        const { partyA, partyB, lang } = body;
        const id = `dadgar_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
        const caseItem = {
          id,
          partyA: {
            name: (partyA?.name || "").trim() || (lang === "en" ? "Party A" : "طرف اول"),
            claimText: (partyA?.claimText || "").trim(),
            evidenceNotes: (partyA?.evidenceNotes || "").trim(),
          },
          partyB: {
            name: (partyB?.name || "").trim() || (lang === "en" ? "Party B" : "طرف دوم"),
            claimText: (partyB?.claimText || "").trim(),
            evidenceNotes: (partyB?.evidenceNotes || "").trim(),
          },
          lang: lang === "en" ? "en" : "fa",
          createdAt: Date.now(),
        };
        casesStore.set(id, caseItem);
        return jsonResponse({ success: true, caseId: id, caseData: caseItem });
      } catch (err) {
        return jsonResponse({ error: err?.message }, 500);
      }
    }

    // 4. /api/cases/:id
    if (pathname.startsWith("/api/cases/")) {
      const caseId = pathname.replace("/api/cases/", "").trim();
      if (method === "GET") {
        const item = casesStore.get(caseId);
        if (!item) return jsonResponse({ error: "Case not found" }, 404);
        return jsonResponse({ success: true, caseData: item });
      }
      if (method === "PUT") {
        const item = casesStore.get(caseId) || { id: caseId, createdAt: Date.now() };
        const body = await request.json().catch(() => ({}));
        if (body.partyB) {
          item.partyB = {
            name: (body.partyB.name || item.partyB?.name || "").trim(),
            claimText: (body.partyB.claimText || item.partyB?.claimText || "").trim(),
            evidenceNotes: (body.partyB.evidenceNotes || item.partyB?.evidenceNotes || "").trim(),
          };
        }
        if (body.verdict) item.verdict = body.verdict;
        item.updatedAt = Date.now();
        casesStore.set(caseId, item);
        return jsonResponse({ success: true, caseData: item });
      }
    }

    // 5. /api/payments
    if (pathname === "/api/payments/variza/confirm" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      return jsonResponse({ success: true, paid: true, decreeCode: body?.decreeCode });
    }
    if (pathname === "/api/payments/paypal/confirm" && method === "POST") {
      const body = await request.json().catch(() => ({}));
      return jsonResponse({ success: true, paid: true, decreeCode: body?.decreeCode });
    }
    if (pathname.startsWith("/api/payments/status/") && method === "GET") {
      return jsonResponse({ paid: true });
    }

    // Default: Fallback to static assets
    if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
