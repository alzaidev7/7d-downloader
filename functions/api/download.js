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

async function queryCobaltInstance(endpoint, targetUrl, apiKey = "") {
  const headers = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "User-Agent": "7D-Downloader/1.0",
  };
  if (apiKey) {
    headers["Authorization"] = `Api-Key ${apiKey}`;
  }

  const [hdRes, sdRes, mp3Res] = await Promise.allSettled([
    fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: targetUrl, videoQuality: "1080" }),
    }),
    fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: targetUrl, videoQuality: "480" }),
    }),
    fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: targetUrl, downloadMode: "audio", audioFormat: "mp3" }),
    }),
  ]);

  const links = [];
  let title = "7D Media Download";

  if (hdRes.status === "fulfilled" && hdRes.value.ok) {
    const hd = await hdRes.value.json().catch(() => null);
    if (hd?.url?.startsWith("https://")) {
      if (hd.filename) title = hd.filename;
      links.push({ label: "Download MP4 HD", url: hd.url, quality: "hd", type: "mp4" });
    }
  }
  if (sdRes.status === "fulfilled" && sdRes.value.ok) {
    const sd = await sdRes.value.json().catch(() => null);
    if (sd?.url?.startsWith("https://")) {
      links.push({ label: "Download MP4 (Standar)", url: sd.url, quality: "sd", type: "mp4" });
    }
  }
  if (mp3Res.status === "fulfilled" && mp3Res.value.ok) {
    const mp3 = await mp3Res.value.json().catch(() => null);
    if (mp3?.url?.startsWith("https://")) {
      links.push({ label: "Download MP3 (Audio)", url: mp3.url, quality: "audio", type: "mp3" });
    }
  }

  return links.length ? { title, links } : null;
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
    const endpoints = [];

    if (env.EXTRACTOR_API_URL) {
      endpoints.push({ url: env.EXTRACTOR_API_URL, key: env.EXTRACTOR_API_KEY || "" });
    }
    endpoints.push(
      { url: "https://cobalt-api.kwiatekmiki.com/", key: "" },
      { url: "https://cobalt-backend.canine.tools/", key: "" },
      { url: "https://api.cobalt.tools/", key: "" }
    );

    for (const ep of endpoints) {
      const result = await queryCobaltInstance(ep.url, fullUrl, ep.key);
      if (result) {
        return Response.json({ ok: true, ...result });
      }
    }

    return Response.json(
      {
        ok: false,
        error: "Server ekstraktor sedang sibuk atau video dibatasi login/privasi. Coba lagi beberapa saat.",
      },
      { status: 502 }
    );
  } catch {
    return Response.json({ ok: false, error: "Terjadi kesalahan pada server downloader." }, { status: 500 });
  }
}
