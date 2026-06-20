export async function onRequestPost(context) {
  try {
    const data = await context.request.json();
    const { message } = data;

    // In production, you would bind a KV namespace or D1 database here:
    // await context.env.FEEDBACK_KV.put(`feedback_${Date.now()}`, message);

    // Or send it to a Discord webhook if configured in Cloudflare Pages settings
    if (context.env.DISCORD_WEBHOOK) {
      await fetch(context.env.DISCORD_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `**New Feedback Received:**\n> ${message}` }),
      });
    }

    console.log("Feedback logged on Edge:", message);

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
