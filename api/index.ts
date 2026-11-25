import { getEnvValue, getGeminiKey, handleCorsAndOptions } from "./_lib/http.js";
import {
  handleCases,
  handleDecreePdf,
  handleDeliberate,
  handlePaymentCheckout,
  handlePaymentStatus,
  handlePaypalConfirm,
  handleTranscribe,
  handleVarizaConfirm,
  handleZibalCallback,
  handleZibalRequest,
} from "./_lib/handlers.js";

function resolveApiSubPath(req: any): string {
  const qPath = req?.query?.__apiPath;
  if (typeof qPath === "string" && qPath.trim()) {
    return qPath.replace(/^\/+|\/+$/g, "");
  }
  if (Array.isArray(qPath) && qPath.length > 0) {
    return qPath.join("/").replace(/^\/+|\/+$/g, "");
  }
  try {
    const rawUrl = String(req?.url || "");
    const u = new URL(rawUrl, "http://localhost");
    return u.pathname.replace(/^\/?api\/?/, "").replace(/^\/+|\/+$/g, "");
  } catch {
    return "";
  }
}

export default async function handler(req: any, res: any) {
  try {
    if (handleCorsAndOptions(req, res)) return;

    const subPath = resolveApiSubPath(req);

    if (subPath === "health") {
      const apiKey = getGeminiKey(req);
      const judgeBrainUrl = getEnvValue("JUDGE_BRAIN_URL");
      return res.status(200).json({
        ok: true,
        geminiConfigured: Boolean(apiKey),
        judgeBrainConfigured: Boolean(judgeBrainUrl),
      });
    }
    if (subPath === "transcribe") {
      return await handleTranscribe(req, res);
    }
    if (subPath === "deliberate" || subPath === "judge") {
      return await handleDeliberate(req, res);
    }
    if (subPath === "cases") {
      return await handleCases(req, res);
    }
    if (subPath.startsWith("cases/")) {
      const caseId = decodeURIComponent(subPath.slice("cases/".length));
      return await handleCases(req, res, caseId);
    }
    if (subPath === "decree/pdf") {
      return await handleDecreePdf(req, res);
    }
    if (subPath === "payments/checkout") {
      return await handlePaymentCheckout(req, res);
    }
    if (subPath === "payments/status") {
      return await handlePaymentStatus(req, res);
    }
    if (subPath === "payments/variza/confirm") {
      return await handleVarizaConfirm(req, res);
    }
    if (subPath === "payments/paypal/confirm") {
      return await handlePaypalConfirm(req, res);
    }
    if (subPath === "payments/zibal/request") {
      return await handleZibalRequest(req, res);
    }
    if (subPath === "payments/zibal/callback") {
      return await handleZibalCallback(req, res);
    }

    return res.status(404).json({ error: `API route not found: /api/${subPath}` });
  } catch (fatalErr: any) {
    console.error("Vercel API router error:", fatalErr?.message || fatalErr);
    if (!res.headersSent) {
      return res.status(500).json({ error: fatalErr?.message || "Internal server error" });
    }
  }
}
