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

async function resolveTikTokUrl(url) {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
      },
    });
    const finalUrl = res.url || url;
    const html = await res.text();
    return { finalUrl: finalUrl.split("?")[0], html };
  } catch {
    return { finalUrl: url, html: "" };
  }
}

function extractFromTikTokHtml(html) {
  if (!html) return null;
  try {
    const match = html.match(
      /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (!match) return null;
    const json = JSON.parse(match[1]);
    const detail =
      json?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;
    if (!detail) return null;

    const links = [];
    const videoUrl = detail.video?.playAddr || detail.video?.downloadAddr;
    const hdUrl =
      detail.video?.bitrateInfo?.[0]?.PlayAddr?.UrlList?.[0] || videoUrl;
    const musicUrl = detail.music?.playUrl;

    if (hdUrl && hdUrl.startsWith("https://")) {
      links.push({
        label: "Download MP4 HD (No Watermark)",
        url: hdUrl,
        quality: "hd",
        type: "mp4",
      });
    }
    if (videoUrl && videoUrl.startsWith("https://")) {
      links.push({
        label: "Download MP4 (Standar)",
        url: videoUrl,
        quality: "sd",
        type: "mp4",
      });
    }
    if (musicUrl && musicUrl.startsWith("https://")) {
      links.push({
        label: "Download MP3 (Audio Original)",
        url: musicUrl,
        quality: "audio",
        type: "mp3",
      });
    }

    return links.length
      ? { title: detail.desc || "TikTok Video", links }
      : null;
  } catch {
    return null;
  }
}

async function fetchTikTokViaTikWm(cleanUrl) {
  try {
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}&hd=1`;
    const res = await fetch(apiUrl, {
      headers: {
        "Accept": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://www.tikwm.com/",
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.code !== 0 || !json?.data) return null;

    const d = json.data;
    const links = [];
    if (d.hdplay?.startsWith("https://")) {
      links.push({ label: "Download MP4 HD (No Watermark)", url: d.hdplay, quality: "hd", type: "mp4" });
    }
    if (d.play?.startsWith("https://")) {
      links.push({ label: "Download MP4 (No Watermark)", url: d.play, quality: "sd", type: "mp4" });
    }
    if (d.music?.startsWith("https://")) {
      links.push({ label: "Download MP3 (Audio Original)", url: d.music, quality: "audio", type: "mp3" });
    }
    return links.length ? { title: d.title || "TikTok Video", links } : null;
  } catch {
    return null;
  }
}

async function fetchViaCustomExtractor(targetUrl, env) {
  if (!env.EXTRACTOR_API_URL) return null;
  const headers = {
    "Accept": "application/json",
    "Content-Type": "application/json",
  };
  if (env.EXTRACTOR_API_KEY) {
    headers["Authorization"] = `Api-Key ${env.EXTRACTOR_API_KEY}`;
  }

  const [hdRes, sdRes, mp3Res] = await Promise.allSettled([
    fetch(env.EXTRACTOR_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: targetUrl, videoQuality: "1080" }),
    }),
    fetch(env.EXTRACTOR_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: targetUrl, videoQuality: "480" }),
    }),
    fetch(env.EXTRACTOR_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: targetUrl, downloadMode: "audio", audioFormat: "mp3" }),
    }),
  ]);

  const links = [];
  let title = "7D Media Download";

  if (hdRes.status === "fulfilled" && hdRes.value.ok) {
    const hd = await hdRes.value.json();
    if (hd?.url?.startsWith("https://")) {
      if (hd.filename) title = hd.filename;
      links.push({ label: "Download MP4 HD", url: hd.url, quality: "hd", type: "mp4" });
    }
  }
  if (sdRes.status === "fulfilled" && sdRes.value.ok) {
    const sd = await sdRes.value.json();
    if (sd?.url?.startsWith("https://")) {
      links.push({ label: "Download MP4 (Standar)", url: sd.url, quality: "sd", type: "mp4" });
    }
  }
  if (mp3Res.status === "fulfilled" && mp3Res.value.ok) {
    const mp3 = await mp3Res.value.json();
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

    const host = parsed.hostname.toLowerCase();
    const fullUrl = parsed.toString();
    let result = null;

    if (host.includes("tiktok.com")) {
      const { finalUrl, html } = await resolveTikTokUrl(fullUrl);
      // Jalur 1: TikWM dengan URL penuh yang sudah di-resolve
      result = await fetchTikTokViaTikWm(finalUrl);
      // Jalur 2: Ekstrak langsung dari data halaman resmi TikTok
      if (!result) {
        result = extractFromTikTokHtml(html);
      }
    }

    if (!result) {
      result = await fetchViaCustomExtractor(fullUrl, env);
    }

    if (!result) {
      return Response.json(
        {
          ok: false,
          error: host.includes("tiktok.com")
            ? "Gagal mengambil video TikTok. Coba salin ulang tautan langsung dari tombol Bagikan."
            : "Untuk platform non-TikTok, atur EXTRACTOR_API_URL di Environment Variables Cloudflare Pages.",
        },
        { status: 502 }
      );
    }

    return Response.json({ ok: true, ...result });
  } catch {
    return Response.json({ ok: false, error: "Terjadi kesalahan pada server downloader." }, { status: 500 });
  }
}
