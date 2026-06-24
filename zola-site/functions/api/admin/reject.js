// functions/api/admin/reject.js
import { makeErrorResponse } from "../utils.js";

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;
  const db = env.DB;
  const bucket = env.GALLERY_BUCKET;

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${env.ADMIN_SECRET_TOKEN}`) {
    return makeErrorResponse("Unauthorized admin secret key.", 401);
  }

  try {
    const { id } = await request.json();
    if (!id) return makeErrorResponse("Missing target id.");

    // Check keys
    const item = await db
      .prepare("SELECT r2_json_key, r2_thumb_key FROM gallery_items WHERE id = ?")
      .bind(id)
      .first();

    if (!item) {
      return makeErrorResponse("Target item does not exist.", 404);
    }

    // SQLite foreign keys check
    await db.prepare("PRAGMA foreign_keys = ON;").run();

    // DB-First deletion
    await db.prepare("DELETE FROM gallery_items WHERE id = ?").bind(id).run();

    // Non-blocking asynchronous storage cleanup
    waitUntil(
      (async () => {
        await bucket.delete(item.r2_json_key);
        await bucket.delete(item.r2_thumb_key);
      })(),
    );

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return makeErrorResponse(`Reject action failed: ${e.message}`, 500);
  }
}
