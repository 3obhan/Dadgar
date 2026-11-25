import "dotenv/config";
import express from "express";
import cors from "cors";
import { COGNITIVE_MODES } from "./core/cognitiveModes.js";
import { createUniversalBrain } from "./sdk.js";

const app = express();
const PORT = Number(process.env.PORT || 8787);
const brain = createUniversalBrain();

app.use(cors());
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "universal-ai-brain",
    version: "2.0.0",
    port: PORT,
    ...brain.status(),
  });
});

app.get("/v1/modes", (_req, res) => {
  res.json({
    modes: Object.values(COGNITIVE_MODES).map((m) => ({
      mode: m.mode,
      title: m.title,
      guidance: m.systemGuidance,
    })),
  });
});

app.post("/v1/verify", (req, res) => {
  const { text, primaryText, secondaryText } = req.body || {};
  const primary = String(primaryText || text || "").trim();
  if (!primary) {
    return res.status(400).json({ error: "text or primaryText is required" });
  }
  const result = brain.verifyFacts(primary, secondaryText ? String(secondaryText) : undefined);
  return res.json({ matched: Boolean(result), verification: result });
});

app.post("/v1/think", async (req, res) => {
  try {
    const result = await brain.think(req.body || {});
    return res.json(result);
  } catch (err: any) {
    const message = String(err?.message || err || "Brain execution failed");
    const status = message.includes("required") ? 400 : message.includes("No AI provider") ? 503 : 502;
    return res.status(status).json({ error: { message } });
  }
});

// Drop-in compatible endpoint for arbitration / JUDGE_BRAIN_URL
app.post("/v1/arbitrate", async (req, res) => {
  try {
    const body = req.body || {};
    const result = await brain.think({
      ...body,
      mode: "arbitrate",
    });
    return res.json({
      provider: result.provider,
      model: result.model,
      verdict: result.output,
      symbolicCheck: result.symbolicCheck,
    });
  } catch (err: any) {
    return res.status(502).json({
      error: {
        code: "BRAIN_ARBITRATION_FAILED",
        message: String(err?.message || err),
        retryable: true,
      },
    });
  }
});

app.post("/api/deliberate", async (req, res) => {
  try {
    const body = req.body || {};
    const result = await brain.think({
      ...body,
      mode: "arbitrate",
    });
    return res.json({
      provider: result.provider,
      model: result.model,
      verdict: result.output,
    });
  } catch (err: any) {
    return res.status(502).json({
      error: {
        code: "BRAIN_ARBITRATION_FAILED",
        message: String(err?.message || err),
        retryable: true,
      },
    });
  }
});

app.post("/v1/memory", (req, res) => {
  try {
    const { projectId, content, kind, tags, importance } = req.body || {};
    if (!projectId || !content) {
      return res.status(400).json({ error: "projectId and content are required" });
    }
    const saved = brain.remember({
      projectId: String(projectId),
      content: String(content),
      kind,
      tags,
      importance,
    });
    return res.status(201).json({ ok: true, entry: saved });
  } catch (err: any) {
    return res.status(400).json({ error: String(err?.message || err) });
  }
});

app.get("/v1/memory/:projectId", (req, res) => {
  const entries = brain.listMemory(req.params.projectId);
  return res.json({ projectId: req.params.projectId, count: entries.length, entries });
});

app.delete("/v1/memory/:projectId", (req, res) => {
  brain.clearMemory(req.params.projectId);
  return res.json({ ok: true, projectId: req.params.projectId });
});

app.get("/", (_req, res) => {
  const { providers } = brain.status();
  const activeLabels = providers.filter((p) => p.configured).map((p) => p.kind);
  const badgeText =
    activeLabels.length > 0
      ? `موتورهای فعال: ${activeLabels.join(" ← ")} ✓`
      : "هیچ ارائه‌دهنده‌ای در .env تنظیم نشده است";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Universal AI Brain v2 — آزمایشگاه مغز شناختی</title>
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700;900&display=swap" rel="stylesheet" />
  <style>
    body{margin:0;font-family:Vazirmatn,Tahoma,sans-serif;background:#fff;color:#111;}
    .wrap{max-width:920px;margin:0 auto;padding:28px 18px;}
    .card{border:2px solid #111;border-radius:4px;padding:18px;background:#fff;box-shadow:4px 4px 0 #111;margin-bottom:18px;}
    label{display:block;font-size:12px;font-weight:700;margin-bottom:5px;}
    input,select,textarea{width:100%;box-sizing:border-box;border:1.5px solid #111;border-radius:3px;padding:9px 11px;font-family:inherit;font-size:13px;background:#fafafa;}
    button{background:#FFC400;color:#111;border:2px solid #111;border-radius:3px;padding:11px 20px;font-weight:900;font-family:inherit;cursor:pointer;box-shadow:3px 3px 0 #111;}
    button:disabled{opacity:.6;cursor:not-allowed;}
    pre{background:#111;color:#FFC400;padding:14px;border-radius:3px;overflow:auto;font-size:12px;direction:ltr;text-align:left;}
  </style>
</head>
<body>
  <div class="wrap">
    <div style="border-bottom:3px solid #111;padding-bottom:14px;margin-bottom:20px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;">
      <div>
        <div style="font-size:12px;font-weight:700;color:#555;">UNIVERSAL COGNITIVE AI BRAIN · REUSABLE CORE v2</div>
        <h1 style="margin:4px 0 0;font-size:22px;font-weight:900;">مغز هوش مصنوعی چندمنظوره برای تمام پروژه‌ها</h1>
      </div>
      <div style="background:${activeLabels.length > 0 ? "#FFC400" : "#fee2e2"};border:1.5px solid #111;padding:6px 12px;font-size:12px;font-weight:800;border-radius:3px;">
        ${badgeText}
      </div>
    </div>

    <div class="card">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;">
        <div>
          <label>حالت شناختی (Cognitive Mode)</label>
          <select id="mode">
            <option value="reason">reason — تحلیل عمیق و اصول اول</option>
            <option value="architect">architect — معماری سیستم و مهندسی</option>
            <option value="extract">extract — استخراج ساختاریافته داده</option>
            <option value="tutor">tutor — آموزش و کشف خطاهای ذهنی</option>
          </select>
        </div>
        <div>
          <label>شناسه حافظه پروژه (projectId)</label>
          <input id="projectId" value="my-next-project" />
        </div>
        <div>
          <label>بازبینی دو مرحله‌ای (Deep Think)</label>
          <select id="deepThink">
            <option value="false">خاموش (سریع‌تر)</option>
            <option value="true">روشن (نقد و اصلاح خودکار)</option>
          </select>
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <label>مسئله، سوال یا سناریو</label>
        <textarea id="prompt" rows="4">یک سیستم پرداخت آنلاین برای اپلیکیشن موبایل طراحی کن که اگر اینترنت وسط تراکنش قطع شد، پول کاربر دوبار کم نشود. بودجه سرور ماهانه ۳۰ دلار و هزینه ریسک با ۳۸ * ۱۲ محاسبه شود.</textarea>
      </div>
      <button id="runBtn" type="button">اجرای مغز شناختی (POST /v1/think)</button>
      <div id="outBox" style="margin-top:14px;display:none;">
        <pre id="outPre"></pre>
      </div>
    </div>
  </div>
  <script>
    const btn = document.getElementById('runBtn');
    const outBox = document.getElementById('outBox');
    const outPre = document.getElementById('outPre');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'در حال استدلال و راستی‌آزمایی...';
      outBox.style.display = 'block';
      outPre.textContent = 'Thinking...';
      try {
        const res = await fetch('/v1/think', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: document.getElementById('mode').value,
            projectId: document.getElementById('projectId').value,
            deepThink: document.getElementById('deepThink').value === 'true',
            rememberOutcome: true,
            prompt: document.getElementById('prompt').value
          })
        });
        outPre.textContent = JSON.stringify(await res.json(), null, 2);
      } catch (e) {
        outPre.textContent = String(e);
      } finally {
        btn.disabled = false;
        btn.textContent = 'اجرای مغز شناختی (POST /v1/think)';
      }
    });
  </script>
</body>
</html>`);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Universal AI Brain] Listening on http://0.0.0.0:${PORT}`);
});
