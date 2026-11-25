/**
 * Cloudflare Pages Function: /api/cases/[id]
 */

const casesMap = new Map();

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Goog-Api-Key, X-Api-Key",
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Goog-Api-Key, X-Api-Key",
    },
  });
}

export async function onRequestGet(context) {
  const { params } = context;
  const id = params.id;
  const item = casesMap.get(id);
  if (!item) return jsonResponse({ error: "Case not found" }, 404);
  return jsonResponse({ success: true, caseData: item });
}

export async function onRequestPut(context) {
  const { params, request } = context;
  const id = params.id;
  const item = casesMap.get(id) || { id, createdAt: Date.now() };
  try {
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
    casesMap.set(id, item);
    return jsonResponse({ success: true, caseData: item });
  } catch (err) {
    return jsonResponse({ error: err?.message }, 500);
  }
}
