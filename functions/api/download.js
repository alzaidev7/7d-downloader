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

// ==========================================
// 1. EKSTRAKTOR YOUTUBE & SHORTS
// ==========================================
function extractYouTubeId(parsed) {
  const host = parsed.hostname.toLowerCase();
  if (host === "youtu.be") {
    return parsed.pathname.slice(1).split("/")[0];
  }
  if (parsed.pathname.startsWith("/shorts/")) {
    return parsed.pathname.split("/")[2];
  }
  if (parsed.pathname.startsWith("/embed/")) {
    return parsed.pathname.split("/")[2];
  }
  return parsed.searchParams.get("v");
}

async function fetchYouTubeDirect(parsed) {
  const videoId = extractYouTubeId(parsed);
  if (!videoId) return null;

  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)",
    },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: "IOS",
          clientVersion: "19.29.1",
          deviceMake: "Apple",
          deviceModel: "iPhone16,2",
          hl: "id",
          gl: "ID",
        },
      },
    }),
  });

  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const streaming = data?.streamingData;
  if (!streaming) return null;

  const title = data?.videoDetails?.title || "YouTube Video";
  const links = [];

  const formats = streaming.formats || [];
  const adaptive = streaming.adaptiveFormats || [];

  // Video dengan audio (muxed MP4)
  const hdMuxed = formats.find((f) => f.url && (f.height >= 720 || f.itag === 22));
  const sdMuxed = formats.find((f) => f.url && (f.itag === 18 || f.height <= 480)) || formats.find((f) => f.url);

  // Adaptive 1080p/720p jika muxed HD tidak tersedia
  const hdAdaptive = adaptive.find(
    (f) => f.url && f.mimeType?.includes("video/mp4") && f.height >= 720
  );

  // Audio M4A / MP3 stream
  const audioStream = adaptive.find(
    (f) => f.url && f.mimeType?.includes("audio/mp4")
  );

  if (hdMuxed?.url) {
    links.push({
      label: `Download MP4 HD (${hdMuxed.qualityLabel || "720p"})`,
      url: hdMuxed.url,
      quality: "hd",
      type: "mp4",
    });
  } else if (hdAdaptive?.url) {
    links.push({
      label: `Download MP4 HD (${hdAdaptive.qualityLabel || "1080p"})`,
      url: hdAdaptive.url,
      quality: "hd",
      type: "mp4",
    });
  }

  if (sdMuxed?.url) {
    links.push({
      label: `Download MP4 (${sdMuxed.qualityLabel || "360p"})`,
      url: sdMuxed.url,
      quality: "sd",
      type: "mp4",
    });
  }

  if (audioStream?.url) {
    links.push({
      label: "Download Audio (M4A / MP3)",
      url: audioStream.url,
      quality: "audio",
      type: "mp3",
    });
  }

  return links.length ? { title, links } : null;
}

// ==========================================
// 2. EKSTRAKTOR INSTAGRAM (REELS & POST)
// ==========================================
async function fetchInstagramDirect(parsed) {
  const match = parsed.pathname.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  if (!match) return null;
  const shortcode = match[2];

  const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
  const res = await fetch(embedUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!res.ok) return null;
  const html = await res.text();

  const videoMatches = [...html.matchAll(/"video_url":"(https:[^"]+)"/g)];
  if (!videoMatches.length) return null;

  const cleanVideoUrl = JSON.parse(`"${videoMatches[0][1]}"`);
  if (!cleanVideoUrl.startsWith("https://")) return null;

  const captionMatch = html.match(/class="CaptionUsername"[^>]*>([^<]+)</);
  const title = captionMatch
    ? `Instagram Video (@${captionMatch[1].trim()})`
    : `Instagram Reel (${shortcode})`;

  return {
    title,
    links: [
      {
        label: "Download MP4 HD (No Watermark)",
        url: cleanVideoUrl,
        quality: "hd",
        type: "mp4",
      },
      {
        label: "Download MP4 (Standar)",
        url: cleanVideoUrl,
        quality: "sd",
        type: "mp4",
      },
    ],
  };
}

// ==========================================
// 3. EKSTRAKTOR FACEBOOK (WATCH & REELS)
// ==========================================
async function fetchFacebookDirect(fullUrl) {
  const res = await fetch(fullUrl, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Fetch-Mode": "navigate",
    },
  });

  if (!res.ok) return null;
  const html = await res.text();

  const hdMatch = html.match(/"browser_native_hd_url":"(https:[^"]+)"/);
  const sdMatch = html.match(/"browser_native_sd_url":"(https:[^"]+)"/);

  const links = [];
  if (hdMatch) {
    const hdUrl = JSON.parse(`"${hdMatch[1]}"`);
    if (hdUrl.startsWith("https://")) {
      links.push({
        label: "Download MP4 HD",
        url: hdUrl,
        quality: "hd",
        type: "mp4",
      });
    }
  }
  if (sdMatch) {
    const sdUrl = JSON.parse(`"${sdMatch[1]}"`);
    if (sdUrl.startsWith("https://")) {
      links.push({
        label: "Download MP4 (Standar)",
        url: sdUrl,
        quality: "sd",
        type: "mp4",
      });
    }
  }

  if (!links.length) return null;

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch
    ? titleMatch[1].replace(/\s*\|\s*Facebook.*$/i, "").trim()
    : "Facebook Video";

  return { title, links };
}

// ==========================================
// 4. CADANGAN CUSTOM EXTRACTOR (OPSIONAL)
// ==========================================
async function fetchViaCustomExtractor(targetUrl, env) {
  if (!env.EXTRACTOR_API_URL) return null;
  const headers = {
    "Accept": "application/json",
    "Content-Type": "application/json",
  };
  if (env.EXTRACTOR_API_KEY) {
    headers["Authorization"] = `Api-Key ${env.EXTRACTOR_API_KEY}`;
  }

  const res = await fetch(env.EXTRACTOR_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: targetUrl, videoQuality: "720" }),
  }).catch(() => null);

  if (!res || !res.ok) return null;
  const json = await res.json().catch(() => null);
  if (!json?.url?.startsWith("https://")) return null;

  return {
    title: json.filename || "7D Media Download",
    links: [
      { label: "Download MP4", url: json.url, quality: "sd", type: "mp4" },
    ],
  };
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

    if (host.includes("youtube.com") || host === "youtu.be") {
      result = await fetchYouTubeDirect(parsed);
    } else if (host.includes("instagram.com")) {
      result = await fetchInstagramDirect(parsed);
    } else if (host.includes("facebook.com") || host === "fb.watch") {
      result = await fetchFacebookDirect(fullUrl);
    }

    if (!result) {
      result = await fetchViaCustomExtractor(fullUrl, env);
    }

    if (!result) {
      return Response.json(
        {
          ok: false,
          error: "Video tidak dapat diambil. Pastikan akun/postingan bersifat publik (bukan privat atau khusus teman).",
        },
        { status: 502 }
      );
    }

    return Response.json({ ok: true, ...result });
  } catch {
    return Response.json({ ok: false, error: "Terjadi kesalahan pada server downloader." }, { status: 500 });
  }
}
