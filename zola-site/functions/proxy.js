export async function onRequest(context) {
    const url = new URL(context.request.url).searchParams.get('url');
    if (!url) {
        return new Response('Missing url parameter', { status: 400 });
    }

    try {
        // Fetch the target URL
        const imageResponse = await fetch(url, {
            headers: {
                // Some servers block requests without a User-Agent
                'User-Agent': 'Vectomancy/1.0 (Cloudflare Pages Proxy)'
            }
        });

        if (!imageResponse.ok) {
            return new Response(`Proxy fetch failed: ${imageResponse.status}`, { status: imageResponse.status });
        }

        // Clone the response so we can modify headers
        const newResponse = new Response(imageResponse.body, imageResponse);

        // Inject CORS headers so our frontend can read the pixel data
        newResponse.headers.set('Access-Control-Allow-Origin', '*');
        newResponse.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');

        return newResponse;
    } catch (e) {
        return new Response(e.message, { status: 500 });
    }
}
