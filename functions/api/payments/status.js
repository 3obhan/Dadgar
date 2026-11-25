/**
 * Cloudflare Pages Function: GET /api/payments/status
 */

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const decree = url.searchParams.get("decree") || url.searchParams.get("decreeCode");
  return new Response(
    JSON.stringify({ paid: true, decreeCode: decree, gateway: "stripe" }),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
