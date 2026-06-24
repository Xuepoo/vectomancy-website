// functions/api/admin/queue.js
import { makeErrorResponse } from "../utils.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${env.ADMIN_SECRET_TOKEN}`) {
    return makeErrorResponse("Unauthorized admin secret key.", 401);
  }

  try {
    const rows = await db
      .prepare(
        "SELECT id, title, author_name, source_url, aspect_ratio, created_at FROM gallery_items WHERE status = 'pending' ORDER BY created_at ASC",
      )
      .all();
    return new Response(JSON.stringify(rows.results), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return makeErrorResponse(`Queue fetch failed: ${e.message}`, 500);
  }
}
