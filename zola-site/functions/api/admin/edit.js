// functions/api/admin/edit.js
// Updates DB metadata of a gallery item.
import { makeErrorResponse } from "../utils.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${env.ADMIN_SECRET_TOKEN}`) {
    return makeErrorResponse("Unauthorized admin secret key.", 401);
  }

  try {
    const { id, title, author_name, source_url } = await request.json();
    if (!id) return makeErrorResponse("Missing target id.");

    const trimmedTitle = title?.toString().trim();
    const trimmedAuthor = author_name?.toString().trim();
    let trimmedSource = source_url?.toString().trim() || null;

    if (!trimmedTitle || trimmedTitle.length > 50) {
      return makeErrorResponse("Title is required (max 50 chars).");
    }
    if (!trimmedAuthor || trimmedAuthor.length > 30) {
      return makeErrorResponse("Author Name is required (max 30 chars).");
    }
    if (trimmedSource === "") trimmedSource = null;

    // Fetch item first to check existence
    const item = await db.prepare("SELECT id FROM gallery_items WHERE id = ?").bind(id).first();

    if (!item) {
      return makeErrorResponse("Item not found.", 404);
    }

    // Update gallery item metadata in D1
    await db
      .prepare("UPDATE gallery_items SET title = ?, author_name = ?, source_url = ? WHERE id = ?")
      .bind(trimmedTitle, trimmedAuthor, trimmedSource, id)
      .run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return makeErrorResponse(`Edit action failed: ${e.message}`, 500);
  }
}
