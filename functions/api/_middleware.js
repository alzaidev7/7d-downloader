async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (!["GET", "POST", "OPTIONS"].includes(request.method)) {
    return Response.json({ ok: false, error: "Method tidak diizinkan." }, { status: 405 });
  }

  // 1. Validasi Origin untuk POST (blokir tembakan API dari domain luar)
  if (request.method === "POST") {
    const origin = request.headers.get("Origin");
    if (!origin || origin !== url.origin) {
      return Response.json({ ok: false, error: "Origin tidak diizinkan." }, { status: 403 });
    }
  }

  // 2. Rate limiting D1 dengan IP yang sudah di-hash (maks. 25 req/menit)
  if (request.method === "POST" && env.DB) {
    const rawIp = request.headers.get("CF-Connecting-IP") || "unknown";
    const ipHash = await sha256Hex(rawIp);
    const now = Math.floor(Date.now() / 1000);
    const windowBucket = Math.floor(now / 60);
    const bucketKey = `rl:${ipHash}:${windowBucket}`;

    try {
      const row = await env.DB.prepare(
        "SELECT count FROM rate_limits WHERE bucket_key = ?1"
      )
        .bind(bucketKey)
        .first();

      if (row && row.count >= 25) {
        return Response.json(
          { ok: false, error: "Terlalu banyak permintaan. Coba lagi 1 menit lagi." },
          { status: 429 }
        );
      }

      await env.DB.prepare(
        `INSERT INTO rate_limits (bucket_key, count, reset_at)
         VALUES (?1, 1, ?2)
         ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1`
      )
        .bind(bucketKey, (windowBucket + 1) * 60)
        .run();
    } catch {
      // Tetap lanjut jika D1 sedang sibuk
    }
  }

  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
