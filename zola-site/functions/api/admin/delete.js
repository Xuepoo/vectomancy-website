// functions/api/admin/delete.js
// Deletes an approved gallery item: removes DB row + R2 assets.
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

    // Fetch R2 keys before deletion
    const item = await db
      .prepare("SELECT r2_json_key, r2_thumb_key, status FROM gallery_items WHERE id = ?")
      .bind(id)
      .first();

    if (!item) {
      return makeErrorResponse("Item not found.", 404);
    }

    // Enable FK cascade for likes ledger cleanup
    await db.prepare("PRAGMA foreign_keys = ON;").run();

    // Delete from DB (cascade removes gallery_likes_ledger rows)
    await db.prepare("DELETE FROM gallery_items WHERE id = ?").bind(id).run();

    // Non-blocking async cleanup of R2 objects
    waitUntil(
      (async () => {
        try {
          await bucket.delete(item.r2_json_key);
          await bucket.delete(item.r2_thumb_key);
        } catch (_) {
          /* best-effort */
        }
      })(),
    );

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return makeErrorResponse(`Delete action failed: ${e.message}`, 500);
  }
}
