// functions/api/utils.js

export function makeErrorResponse(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function validateUuid(uuid) {
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return regex.test(uuid);
}

export function validateWebpHeader(buffer) {
  if (buffer.byteLength < 12) return false;
  const view = new DataView(buffer);

  // Bytes 0-3: 'RIFF' (0x52494646)
  const riff = view.getUint32(0, false);
  // Bytes 8-11: 'WEBP' (0x57454250)
  const webp = view.getUint32(8, false);

  return riff === 0x52494646 && webp === 0x57454250;
}

export function validateAST(astString) {
  try {
    const ast = JSON.parse(astString);
    if (!ast || typeof ast !== "object") return false;
    const type = ast.type?.toLowerCase();
    if (type !== "spline" && type !== "fourier" && type !== "polyline") return false;

    if (type === "spline" && !Array.isArray(ast.equations)) return false;
    if (type === "fourier" && !Array.isArray(ast.strokes)) return false;
    if (type === "polyline" && !Array.isArray(ast.paths)) return false;

    return Array.isArray(ast.bounding_box) && ast.bounding_box.length === 4;
  } catch (e) {
    return false;
  }
}

export async function checkRateLimit(db, ipHash, limit = 60, windowSize = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare("SELECT requests_count, window_reset FROM ip_rate_limits WHERE ip_hash = ?")
    .bind(ipHash)
    .first();

  if (row) {
    if (now < row.window_reset) {
      if (row.requests_count >= limit) {
        return false;
      }
      await db
        .prepare("UPDATE ip_rate_limits SET requests_count = requests_count + 1 WHERE ip_hash = ?")
        .bind(ipHash)
        .run();
    } else {
      await db
        .prepare("UPDATE ip_rate_limits SET requests_count = 1, window_reset = ? WHERE ip_hash = ?")
        .bind(now + windowSize, ipHash)
        .run();
    }
  } else {
    await db
      .prepare(
        "INSERT INTO ip_rate_limits (ip_hash, requests_count, window_reset) VALUES (?, 1, ?)",
      )
      .bind(ipHash, now + windowSize)
      .run();
  }
  return true;
}
