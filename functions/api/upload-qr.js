function detectImageMime(bytes) {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.QR_KV) {
    return Response.json(
      { ok: false, error: "Penyimpanan QR_KV belum terhubung." },
      { status: 500 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("photo");

    if (!file || typeof file === "string") {
      return Response.json({ ok: false, error: "File foto tidak ditemukan." }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
      return Response.json({ ok: false, error: "Ukuran foto maksimal 5 MB." }, { status: 413 });
    }

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const verifiedMime = detectImageMime(bytes);

    if (!verifiedMime) {
      return Response.json(
        { ok: false, error: "Format file tidak valid. Hanya JPG, PNG, atau WebP asli." },
        { status: 415 }
      );
    }

    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    // Simpan biner foto ke Workers KV dengan auto-delete 24 jam (86400 detik)
    await env.QR_KV.put(`photo:${id}`, buffer, {
      expirationTtl: 86400,
      metadata: { mime: verifiedMime },
    });

    const origin = new URL(request.url).origin;
    return Response.json({
      ok: true,
      photoUrl: `${origin}/api/qr/${id}`,
      expiresInHours: 24,
    });
  } catch {
    return Response.json({ ok: false, error: "Gagal memproses unggahan foto." }, { status: 500 });
  }
}
