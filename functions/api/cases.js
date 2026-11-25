/**
 * Cloudflare Pages Function: /api/cases
 */

const casesMap = new Map();

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
  try {
    const body = await context.request.json().catch(() => ({}));
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
    casesMap.set(id, caseItem);
    return jsonResponse({ success: true, caseId: id, caseData: caseItem });
  } catch (err) {
    return jsonResponse({ error: err?.message }, 500);
  }
}
