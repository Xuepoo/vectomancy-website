// functions/api/gallery/submit.js
import { makeErrorResponse, validateWebpHeader, validateAST } from "../utils.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  const bucket = env.GALLERY_BUCKET;

  // 1. Early Content-Length size boundary check (10MB max for complex artworks)
  const contentLength = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (contentLength > 10000000) {
    // 10MB maximum boundary
    return makeErrorResponse("Payload exceeds maximum size limits (10MB).", 413);
  }

  // Guard: require multipart/form-data
  const ct = request.headers.get("Content-Type") || "";
  if (!ct.includes("multipart/form-data")) {
    return makeErrorResponse("Content-Type must be multipart/form-data.", 400);
  }

  try {
    const formData = await request.formData();

    // 1.5 Cloudflare Turnstile Verification
    const turnstileToken = formData.get("cf-turnstile-response");
    if (!turnstileToken) {
      return makeErrorResponse("Missing security verification token.", 400);
    }
    const secretKey = env.TURNSTILE_SECRET_KEY || "1x00000000000000000000000000000000";
    const ip = request.headers.get("CF-Connecting-IP");
    const verifyFormData = new FormData();
    verifyFormData.append("secret", secretKey);
    verifyFormData.append("response", turnstileToken);
    if (ip) {
      verifyFormData.append("remoteip", ip);
    }
    const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: verifyFormData,
    });
    const outcome = await verifyRes.json();
    if (!outcome.success) {
      return makeErrorResponse("Security verification (Turnstile) failed.", 403);
    }

    const title = formData.get("title")?.toString().trim();
    const authorName = formData.get("author_name")?.toString().trim();
    const sourceUrl = formData.get("source_url")?.toString().trim() || null;
    const aspectRatioVal = formData.get("aspect_ratio");
    const astFile = formData.get("ast_json");
    const thumbFile = formData.get("thumbnail");

    // 2. Validate inputs
    if (!title || title.length > 50) return makeErrorResponse("Title is required (max 50 chars).");
    if (!authorName || authorName.length > 30)
      return makeErrorResponse("Author Name is required (max 30 chars).");
    const aspect_ratio = parseFloat(aspectRatioVal);
    if (isNaN(aspect_ratio) || aspect_ratio <= 0) return makeErrorResponse("Invalid aspect ratio.");

    if (!astFile) return makeErrorResponse("Missing AST JSON file.");
    if (!thumbFile || !(thumbFile instanceof File))
      return makeErrorResponse("Missing WebP thumbnail file.");

    // Size boundary checks on individual files
    if (astFile.size > 8000000) return makeErrorResponse("AST JSON size exceeds 8MB limit.", 413);
    if (thumbFile.size > 500000)
      return makeErrorResponse("WebP thumbnail size exceeds 500KB limit.", 413);

    // Validate WebP Image Headers
    const thumbBuffer = await thumbFile.arrayBuffer();
    if (!validateWebpHeader(thumbBuffer)) {
      return makeErrorResponse("Invalid WebP graphic format headers.");
    }

    // Validate AST mathematical schema (support gzip-compressed uploads)
    let astText;
    // Detect gzip by magic bytes 0x1F 0x8B (reliable, not content-type)
    const rawBuf = await astFile.arrayBuffer();
    const magic = new Uint8Array(rawBuf.slice(0, 2));
    const astIsGzip = magic[0] === 0x1f && magic[1] === 0x8b;
    if (astIsGzip) {
      try {
        const responseStream = new Response(rawBuf).body;
        const decompressedStream = responseStream.pipeThrough(new DecompressionStream("gzip"));
        astText = await new Response(decompressedStream).text();
      } catch (e) {
        return makeErrorResponse(`Failed to decompress AST: ${e.message}`, 400);
      }
    } else {
      astText = new TextDecoder().decode(new Uint8Array(rawBuf));
    }

    if (!validateAST(astText)) {
      return makeErrorResponse("AST file schema does not match mathematical specifications.");
    }

    // 3. Generate secure random UUID
    const id = crypto.randomUUID();

    const r2JsonKey = `vectomancy/gallery/ast/${id}.json`;
    const r2ThumbKey = `vectomancy/gallery/thumbs/${id}-thumb.webp`;

    // 4. Upload payloads to Cloudflare R2
    await bucket.put(r2JsonKey, astText, { contentType: "application/json" });
    await bucket.put(r2ThumbKey, thumbBuffer, { contentType: "image/webp" });

    // 5. Write metadata row to Cloudflare D1 Database
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        `
      INSERT INTO gallery_items (id, title, author_name, source_url, r2_json_key, r2_thumb_key, aspect_ratio, created_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `,
      )
      .bind(id, title, authorName, sourceUrl, r2JsonKey, r2ThumbKey, aspect_ratio, now)
      .run();

    return new Response(JSON.stringify({ success: true, id }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return makeErrorResponse(`Submit processing failed: ${e.message}`, 500);
  }
}
