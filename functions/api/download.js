const ALLOWED_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
  "tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
  "instagram.com", "www.instagram.com",
  "facebook.com", "www.facebook.com", "m.facebook.com", "fb.watch",
]);

function validateTargetUrl(raw) {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const cleanUrl = validateTargetUrl(String(body?.url || "").trim());

    if (!cleanUrl) {
      return Response.json(
        { ok: false, error: "Gunakan tautan HTTPS resmi dari YouTube, TikTok, Instagram, atau Facebook." },
        { status: 400 }
      );
    }

    // Endpoint engine ekstraktor (set di Environment Variables Cloudflare Pages: EXTRACTOR_API_URL)
    const apiBase = env.EXTRACTOR_API_URL || "https://api.cobalt.tools";
    const apiKey = env.EXTRACTOR_API_KEY || "";

    const headers = {
      "Accept": "application/json",
      "Content-Type": "application/json",
    };
    if (apiKey) headers["Authorization"] = `Api-Key ${apiKey}`;

    // Minta opsi Video HD, Video Standar, dan Audio MP3
    const [hdRes, sdRes, mp3Res] = await Promise.allSettled([
      fetch(apiBase, {
        method: "POST",
        headers,
        body: JSON.stringify({ url: cleanUrl, videoQuality: "1080", filenameStyle: "basic" }),
      }),
      fetch(apiBase, {
        method: "POST",
        headers,
        body: JSON.stringify({ url: cleanUrl, videoQuality: "480", filenameStyle: "basic" }),
      }),
      fetch(apiBase, {
        method: "POST",
        headers,
        body: JSON.stringify({ url: cleanUrl, downloadMode: "audio", audioFormat: "mp3" }),
      }),
    ]);

    const links = [];
    let title = "7D Media Download";

    if (hdRes.status === "fulfilled" && hdRes.value.ok) {
      const hdData = await hdRes.value.json();
      if (hdData?.url?.startsWith("https://")) {
        if (hdData.filename) title = hdData.filename;
        links.push({ label: "Download MP4 HD (No Watermark)", url: hdData.url, quality: "hd", type: "mp4" });
      }
    }

    if (sdRes.status === "fulfilled" && sdRes.value.ok) {
      const sdData = await sdRes.value.json();
      if (sdData?.url?.startsWith("https://")) {
        links.push({ label: "Download MP4 (Standar)", url: sdData.url, quality: "sd", type: "mp4" });
      }
    }

    if (mp3Res.status === "fulfilled" && mp3Res.value.ok) {
      const mp3Data = await mp3Res.value.json();
      if (mp3Data?.url?.startsWith("https://")) {
        links.push({ label: "Download MP3 (Audio Saja)", url: mp3Data.url, quality: "audio", type: "mp3" });
      }
    }

    if (links.length === 0) {
      return Response.json(
        { ok: false, error: "Gagal mengambil tautan media. Pastikan video bersifat publik." },
        { status: 502 }
      );
    }

    return Response.json({ ok: true, title, links });
  } catch {
    return Response.json({ ok: false, error: "Terjadi kesalahan pada server downloader." }, { status: 500 });
  }
}
