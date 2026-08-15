export async function onRequest(context) {
  // 0. Handle CORS Preflight OPTIONS
  if (context.request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  const urlStr = new URL(context.request.url).searchParams.get("url");
  if (!urlStr) {
    return new Response("Missing url parameter", { status: 400 });
  }

  try {
    const url = new URL(urlStr);

    // 1. Protocol validation: Only allow http and https
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return new Response("Invalid protocol: Only HTTP/HTTPS URLs are allowed", { status: 400 });
    }

    // 2. SSRF Prevention: Block common private/local hostnames and IPs
    const hostname = url.hostname.toLowerCase();
    const privateHostPatterns = [
      "localhost",
      "127.0.0.1",
      "[::1]",
      "0.0.0.0",
      "169.254.169.254", // AWS/Metadata
      "metadata.google.internal", // Google Metadata
    ];

    // Check if hostname matches any basic private/loopback string or private subnet
    if (
      privateHostPatterns.includes(hostname) ||
      hostname.startsWith("127.") ||
      hostname.startsWith("0.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("100.64.") || // Carrier-Grade NAT
      hostname.startsWith("192.168.") ||
      hostname.startsWith("169.254.") || // Link-local
      hostname.startsWith("::ffff:") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return new Response("SSRF Blocked: Local/Internal addresses are forbidden", { status: 403 });
    }

    // Set up headers to bypass hotlinking protection (especially for Pixiv)
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };

    if (hostname.endsWith("pximg.net") || hostname.includes("pixiv")) {
      headers["Referer"] = "https://www.pixiv.net/";
    }

    // Fetch the target URL
    const imageResponse = await fetch(url.toString(), {
      headers: headers,
    });

    if (!imageResponse.ok) {
      return new Response(`Proxy fetch failed: ${imageResponse.status}`, {
        status: imageResponse.status,
      });
    }

    // Clone the response so we can modify headers
    const newResponse = new Response(imageResponse.body, imageResponse);

    // Inject CORS headers so our frontend can read the pixel data
    newResponse.headers.set("Access-Control-Allow-Origin", "*");
    newResponse.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");

    return newResponse;
  } catch (e) {
    return new Response(e.message, { status: 400 });
  }
}
