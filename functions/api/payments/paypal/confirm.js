/**
 * Cloudflare Pages Function: POST /api/payments/paypal/confirm
 */

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => ({}));
  return new Response(
    JSON.stringify({ success: true, paid: true, decreeCode: body?.decreeCode }),
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
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
