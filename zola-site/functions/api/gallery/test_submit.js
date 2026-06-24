// Modern Node.js has native fetch, FormData, and Blob globally available.

async function run() {
  console.log("Submitting test artwork...");

  const ast = {
    type: "Fourier",
    bounding_box: [0, 0, 100, 100],
    strokes: [
      {
        color_rgb: [255, 0, 0],
        data: [{ amplitude: 10, frequency: 1, phase: 0 }],
      },
    ],
  };

  const webpBuffer = Buffer.from([
    0x52,
    0x49,
    0x46,
    0x46, // RIFF
    0x00,
    0x00,
    0x00,
    0x00, // Size
    0x57,
    0x45,
    0x42,
    0x50, // WEBP
    0x56,
    0x50,
    0x38,
    0x4c, // VP8L (dummy chunk data)
  ]);

  const formData = new FormData();
  formData.append("title", "Fourier Circle");
  formData.append("author_name", "Math Wizard");
  formData.append("source_url", "https://github.com/Xuepoo/vectomancy");
  formData.append("aspect_ratio", "1.0");

  // Note: Node 18+ fetch supports Blob/File in FormData
  const astBlob = new Blob([JSON.stringify(ast)], { type: "application/json" });
  const thumbBlob = new Blob([webpBuffer], { type: "image/webp" });

  formData.append("ast_json", astBlob, "ast.json");
  formData.append("thumbnail", thumbBlob, "thumb.webp");

  const res = await fetch("http://localhost:8788/api/gallery/submit", {
    method: "POST",
    body: formData,
  });

  const text = await res.text();
  console.log("Submit Response Status:", res.status);
  console.log("Submit Response Body:", text);
}

run().catch(console.error);
