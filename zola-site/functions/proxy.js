export async function onRequest(context) {
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

    // Check if hostname matches any basic private/loopback string
    if (
      privateHostPatterns.includes(hostname) ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("172.16.") ||
      hostname.startsWith("172.17.") ||
      hostname.startsWith("172.18.") ||
      hostname.startsWith("172.19.") ||
      hostname.startsWith("172.20.") ||
      hostname.startsWith("172.21.") ||
      hostname.startsWith("172.22.") ||
      hostname.startsWith("172.23.") ||
      hostname.startsWith("172.24.") ||
      hostname.startsWith("172.25.") ||
      hostname.startsWith("172.26.") ||
      hostname.startsWith("172.27.") ||
      hostname.startsWith("172.28.") ||
      hostname.startsWith("172.29.") ||
      hostname.startsWith("172.30.") ||
      hostname.startsWith("172.31.")
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
