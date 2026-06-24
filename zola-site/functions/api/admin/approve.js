// functions/api/admin/approve.js
import { makeErrorResponse } from "../utils.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${env.ADMIN_SECRET_TOKEN}`) {
    return makeErrorResponse("Unauthorized admin secret key.", 401);
  }

  try {
    const { id } = await request.json();
    if (!id) return makeErrorResponse("Missing target id.");

    const now = Math.floor(Date.now() / 1000);
    const res = await db
      .prepare(
        "UPDATE gallery_items SET status = 'approved', approved_at = ? WHERE id = ? AND status = 'pending'",
      )
      .bind(now, id)
      .run();

    if (res.meta.changes === 0) {
      return makeErrorResponse("Item not found or already approved.", 400);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return makeErrorResponse(`Approve action failed: ${e.message}`, 500);
  }
}
