// functions/api/admin/published.js
// Returns paginated list of approved gallery items for the admin dashboard.
import { makeErrorResponse } from "../utils.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${env.ADMIN_SECRET_TOKEN}`) {
    return makeErrorResponse("Unauthorized admin secret key.", 401);
  }

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "24", 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));

  try {
    const rows = await db
      .prepare(
        `
      SELECT id, title, author_name, source_url, r2_thumb_key, aspect_ratio,
             likes_count, created_at, approved_at
      FROM gallery_items
      WHERE status = 'approved'
      ORDER BY approved_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .bind(limit + 1, offset)
      .all();

    const items = rows.results.slice(0, limit).map((row) => ({
      id: row.id,
      title: row.title,
      author_name: row.author_name,
      source_url: row.source_url,
      thumb_url: `https://cdn.xuepoo.xyz/${row.r2_thumb_key}`,
      aspect_ratio: row.aspect_ratio,
      likes_count: row.likes_count,
      created_at: row.created_at,
      approved_at: row.approved_at,
    }));

    const has_more = rows.results.length > limit;

    return new Response(JSON.stringify({ items, has_more }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return makeErrorResponse(`Published list fetch failed: ${e.message}`, 500);
  }
}
