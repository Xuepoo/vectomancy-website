// functions/api/gallery/like.js
import { makeErrorResponse, validateUuid, checkRateLimit } from "../utils.js";

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;
  const db = env.DB;

  try {
    const { item_id, visitor_uuid } = await request.json();

    if (!item_id) return makeErrorResponse("Missing item_id parameter.");
    if (!visitor_uuid || !validateUuid(visitor_uuid)) {
      return makeErrorResponse("Missing or invalid visitor UUID format.");
    }

    // Get Client IP and Hash it
    const ip = request.headers.get("CF-Connecting-IP") || "127.0.0.1";
    const ipEncoder = new TextEncoder().encode(ip);
    const ipBuffer = await crypto.subtle.digest("SHA-256", ipEncoder);
    const ipHash = Array.from(new Uint8Array(ipBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Check IP Hourly Rate limits
    const allowed = await checkRateLimit(db, ipHash);
    if (!allowed) {
      return makeErrorResponse("Rate limit exceeded. Too many likes from this IP address.", 429);
    }

    // Schedule Rate Limit prune asynchronously in context worker
    const now = Math.floor(Date.now() / 1000);
    if (Math.random() < 0.01) {
      // 1% random trigger
      waitUntil(db.prepare("DELETE FROM ip_rate_limits WHERE window_reset < ?").bind(now).run());
    }

    // Verify the item is public
    const item = await db
      .prepare("SELECT status FROM gallery_items WHERE id = ?")
      .bind(item_id)
      .first();
    if (!item || item.status !== "approved") {
      return makeErrorResponse("Cannot like this item.", 400);
    }

    // SQLite foreign keys check
    await db.prepare("PRAGMA foreign_keys = ON;").run();

    // Check likes ledger status
    const existingLike = await db
      .prepare("SELECT liked_at FROM gallery_likes_ledger WHERE item_id = ? AND visitor_uuid = ?")
      .bind(item_id, visitor_uuid)
      .first();

    let liked = false;
    if (existingLike) {
      // Revoke / Unlike operation
      const stmt1 = db
        .prepare("DELETE FROM gallery_likes_ledger WHERE item_id = ? AND visitor_uuid = ?")
        .bind(item_id, visitor_uuid);
      const stmt2 = db
        .prepare("UPDATE gallery_items SET likes_count = MAX(0, likes_count - 1) WHERE id = ?")
        .bind(item_id);

      await db.batch([stmt1, stmt2]);
      liked = false;
    } else {
      // Upvote / Like operation
      const stmt1 = db
        .prepare(
          "INSERT INTO gallery_likes_ledger (item_id, visitor_uuid, liked_at) VALUES (?, ?, ?)",
        )
        .bind(item_id, visitor_uuid, now);
      const stmt2 = db
        .prepare("UPDATE gallery_items SET likes_count = likes_count + 1 WHERE id = ?")
        .bind(item_id);

      await db.batch([stmt1, stmt2]);
      liked = true;
    }

    // Query final likes count
    const updatedItem = await db
      .prepare("SELECT likes_count FROM gallery_items WHERE id = ?")
      .bind(item_id)
      .first();

    return new Response(JSON.stringify({ liked, likes_count: updatedItem.likes_count }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return makeErrorResponse(`Like processing failed: ${e.message}`, 500);
  }
}
