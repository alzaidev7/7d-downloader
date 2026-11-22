const ALLOWED_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
  "tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
  "instagram.com", "www.instagram.com",
  "facebook.com", "www.facebook.com", "m.facebook.com", "fb.watch",
]);

function parseAllowedUrl(raw) {
  const match = String(raw || "").match(/https:\/\/[^\s"'<>]+/);
  if (!match) return null;
  try {
    const parsed = new URL(match[0]);
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function formatDuration(sec) {
  const s = Math.floor(Number(sec) || 0);
  if (s <= 0) return "";
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const parsed = parseAllowedUrl(body?.url);

    if (!parsed) {
      return Response.json(
        { ok: false, error: "Gunakan tautan HTTPS resmi dari TikTok, YouTube, Instagram, atau Facebook." },
        { status: 400 }
      );
    }

    const fullUrl = parsed.toString();
    const endpoint = (env.EXTRACTOR_API_URL || "").replace(/\/+$/, "");
    const apiKey = env.EXTRACTOR_API_KEY || "";

    if (!endpoint) {
      return Response.json(
        { ok: false, error: "EXTRACTOR_API_URL belum diatur di Cloudflare." },
        { status: 500 }
      );
    }

    const headers = {
      "Accept": "application/json",
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Api-Key ${apiKey}`;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: fullUrl }),
    });

    const rawText = await res.text();
    let json = null;
    try {
      json = JSON.parse(rawText);
    } catch {
      json = null;
    }

    // Jika Cloudflare Edge terkena blokir 502 ke Vercel, arahkan browser memanggil langsung
    if (res.status === 502 && !json) {
      return Response.json({
        ok: false,
        directFallback: {
          endpoint,
          apiKey,
          url: fullUrl,
        },
      });
    }

    if (!res.ok) {
      const detail = json?.detail ? ` (${json.detail})` : ` (HTTP ${res.status})`;
      return Response.json(
        { ok: false, error: `Video tidak dapat diambil. Pastikan postingan bersifat publik${detail}.` },
        { status: 502 }
      );
    }

    const links = Array.isArray(json?.links)
      ? json.links.filter((l) => l?.url?.startsWith("https://"))
      : [];

    if (!links.length) {
      return Response.json(
        { ok: false, error: "Tautan unduhan tidak ditemukan." },
        { status: 502 }
      );
    }

    return Response.json({
      ok: true,
      title: (json.title || "7D Media Download").replace(/\.[a-z0-9]+$/i, ""),
      cover: json.cover || "",
      duration: json.duration ? formatDuration(json.duration) : "",
      author: typeof json.author === "string" ? { name: json.author } : json.author || null,
      links,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: `Terjadi kesalahan server: ${err?.message || "unknown"}` },
      { status: 500 }
    );
  }
}
