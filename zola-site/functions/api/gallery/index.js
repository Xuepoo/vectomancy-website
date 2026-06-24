// functions/api/gallery/index.js
import { makeErrorResponse } from "../utils.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;
  const url = new URL(request.url);

  const sort = url.searchParams.get("sort") === "newest" ? "newest" : "popular";
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "24", 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));

  try {
    // Setup correct index sorting statement
    const orderBy = sort === "newest" ? "created_at DESC" : "likes_count DESC, created_at DESC";

    const query = `
      SELECT id, title, author_name, source_url, r2_json_key, r2_thumb_key, aspect_ratio, likes_count, created_at
      FROM gallery_items
      WHERE status = 'approved'
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;

    const rows = await db
      .prepare(query)
      .bind(limit + 1, offset)
      .all();

    const items = rows.results.slice(0, limit).map((row) => ({
      id: row.id,
      title: row.title,
      author_name: row.author_name,
      source_url: row.source_url,
      json_url: `https://cdn.xuepoo.xyz/${row.r2_json_key}`,
      thumb_url: `https://cdn.xuepoo.xyz/${row.r2_thumb_key}`,
      aspect_ratio: row.aspect_ratio,
      likes_count: row.likes_count,
      created_at: row.created_at,
    }));

    const has_more = rows.results.length > limit;

    return new Response(JSON.stringify({ items, has_more }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=10", // edge caching parameter
      },
    });
  } catch (e) {
    return makeErrorResponse(`Fetch query failed: ${e.message}`, 500);
  }
}
