export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.EXTRACTOR_API_URL) {
    return Response.json(
      { ok: false, fallback: true, error: "EXTRACTOR_API_URL belum diatur." },
      { status: 503 }
    );
  }

  try {
    const formData = await request.formData();
    const imageFile = formData.get("image");
    if (!imageFile) {
      return Response.json({ ok: false, error: "File gambar tidak ditemukan." }, { status: 400 });
    }

    const baseUrl = env.EXTRACTOR_API_URL.replace(/\/+$/, "");
    const headers = {};
    if (env.EXTRACTOR_API_KEY) {
      headers["Authorization"] = `Api-Key ${env.EXTRACTOR_API_KEY}`;
    }

    const upstreamForm = new FormData();
    upstreamForm.append("image", imageFile, "input.png");

    const res = await fetch(`${baseUrl}/remove-bg`, {
      method: "POST",
      headers,
      body: upstreamForm,
    });

    if (!res.ok) {
      return Response.json(
        { ok: false, fallback: true, error: "Server AI sedang bangun, beralih ke mode lokal." },
        { status: 502 }
      );
    }

    const pngBuffer = await res.arrayBuffer();
    return new Response(pngBuffer, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { ok: false, fallback: true, error: "Gagal terhubung ke server AI." },
      { status: 502 }
    );
  }
}
