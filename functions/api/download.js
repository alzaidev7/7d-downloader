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
  const pathMatch = parsed.pathname.match(/^\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
  if (pathMatch) {
    return pathMatch[2];
  }
  return parsed.searchParams.get("v");
}

async function queryYouTubeClient(videoId, clientConfig, userAgent) {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": userAgent,
    },
    body: JSON.stringify({
      videoId,
      context: {
        client: clientConfig,
        thirdParty: { embedUrl: "https://www.youtube.com/" },
      },
    }),
  });

  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const streaming = data?.streamingData;
  if (!streaming) return null;

  const title = data?.videoDetails?.title || "YouTube Video";
  const formats = streaming.formats || [];
  const adaptive = streaming.adaptiveFormats || [];

  const hdMuxed = formats.find((f) => f.url && (f.height >= 720 || f.itag === 22));
  const sdMuxed =
    formats.find((f) => f.url && (f.itag === 18 || f.height <= 480)) ||
    formats.find((f) => f.url);
  const hdAdaptive = adaptive.find(
    (f) => f.url && f.mimeType?.includes("video/mp4") && f.height >= 720
  );
  const audioStream = adaptive.find(
    (f) => f.url && f.mimeType?.includes("audio/mp4")
  );

  const links = [];
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

async function fetchYouTubeDirect(parsed) {
  const videoId = extractYouTubeId(parsed);
  if (!videoId) return null;

  // Jalur 1: Embedded TV Client (paling tahan blokir bot IP datacenter)
  let result = await queryYouTubeClient(
    videoId,
    {
      clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
      clientVersion: "2.0",
      hl: "id",
      gl: "ID",
    },
    "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/4.0 TV Safari/537.36"
  );
  if (result) return result;

  // Jalur 2: Android VR Client
  result = await queryYouTubeClient(
    videoId,
    {
      clientName: "ANDROID_VR",
      clientVersion: "1.56.21",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      osName: "Android",
      osVersion: "12L",
      hl: "id",
      gl: "ID",
    },
    "com.google.android.apps.youtube.vr.oculus/1.56.21 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip"
  );
  if (result) return result;

  // Jalur 3: Cadangan Piped Public API
  const pipedNodes = [
    "https://api.piped.private.coffee",
    "https://pipedapi.kavin.rocks",
  ];
  for (const node of pipedNodes) {
    try {
      const res = await fetch(`${node}/streams/${videoId}`, {
        headers: { "User-Agent": "7D-Downloader/1.0" },
      });
      if (!res.ok) continue;
      const json = await res.json();
      const videoStreams = (json.videoStreams || []).filter(
        (s) => s.url && s.format === "MPEG_4" && !s.videoOnly
      );
      const audioStreams = (json.audioStreams || []).filter((s) => s.url);

      const links = [];
      const hd = videoStreams.find((s) => parseInt(s.quality, 10) >= 720);
      const sd = videoStreams[0];

      if (hd) {
        links.push({ label: `Download MP4 HD (${hd.quality})`, url: hd.url, quality: "hd", type: "mp4" });
      }
      if (sd) {
        links.push({ label: `Download MP4 (${sd.quality})`, url: sd.url, quality: "sd", type: "mp4" });
      }
      if (audioStreams[0]) {
        links.push({ label: "Download Audio (M4A / MP3)", url: audioStreams[0].url, quality: "audio", type: "mp3" });
      }
      if (links.length) {
        return { title: json.title || "YouTube Video", links };
      }
    } catch {
      continue;
    }
  }

  return null;
}

// ==========================================
// 2. EKSTRAKTOR INSTAGRAM (REELS, SHARE & POST)
// ==========================================
function decodeJsonString(raw) {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw.replace(/\\\//g, "/").replace(/\\u0026/g, "&");
  }
}

async function fetchInstagramDirect(parsed) {
  let targetPath = parsed.pathname;

  // Jika link berbentuk /share/reel/... atau /share/p/..., ikuti redirect dulu
  if (targetPath.includes("/share/")) {
    try {
      const redirRes = await fetch(parsed.toString(), {
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        },
      });
      targetPath = new URL(redirRes.url).pathname;
    } catch {
      // lanjut pakai path awal
    }
  }

  const match = targetPath.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  if (!match) return null;
  const shortcode = match[2];

  // Jalur 1: Embed Captioned Page (mendukung URL ter-escape \/)
  const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
  const res = await fetch(embedUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (res.ok) {
    const html = await res.text();
    const patterns = [
      /"video_url"\s*:\s*"(https?:[^"]+)"/,
      /"url"\s*:\s*"(https?:[^"]+\.mp4[^"]*)"/,
    ];

    for (const regex of patterns) {
      const m = html.match(regex);
      if (m) {
        const videoUrl = decodeJsonString(m[1]);
        if (videoUrl.startsWith("https://")) {
          const userMatch = html.match(/class="CaptionUsername"[^>]*>([^<]+)</);
          const title = userMatch
            ? `Instagram Video (@${userMatch[1].trim()})`
            : `Instagram Reel (${shortcode})`;

          return {
            title,
            links: [
              { label: "Download MP4 HD (No Watermark)", url: videoUrl, quality: "hd", type: "mp4" },
              { label: "Download MP4 (Standar)", url: videoUrl, quality: "sd", type: "mp4" },
            ],
          };
        }
      }
    }
  }

  // Jalur 2: Public GraphQL Anonymous Query
  try {
    const gqlBody = new URLSearchParams();
    gqlBody.set("variables", JSON.stringify({ shortcode }));
    gqlBody.set("doc_id", "8845758582119845");

    const gqlRes = await fetch("https://www.instagram.com/graphql/query", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        "X-IG-App-ID": "936619743392459",
      },
      body: gqlBody.toString(),
    });

    if (gqlRes.ok) {
      const gqlJson = await gqlRes.json();
      const media = gqlJson?.data?.xdt_shortcode_media;
      const videoUrl = media?.video_url;
      if (videoUrl?.startsWith("https://")) {
        const username = media?.owner?.username;
        return {
          title: username ? `Instagram Video (@${username})` : `Instagram Reel (${shortcode})`,
          links: [
            { label: "Download MP4 HD (No Watermark)", url: videoUrl, quality: "hd", type: "mp4" },
            { label: "Download MP4 (Standar)", url: videoUrl, quality: "sd", type: "mp4" },
          ],
        };
      }
    }
  } catch {
    // abaikan jika dibatasi
  }

  return null;
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
    const hdUrl = decodeJsonString(hdMatch[1]);
    if (hdUrl.startsWith("https://")) {
      links.push({ label: "Download MP4 HD", url: hdUrl, quality: "hd", type: "mp4" });
    }
  }
  if (sdMatch) {
    const sdUrl = decodeJsonString(sdMatch[1]);
    if (sdUrl.startsWith("https://")) {
      links.push({ label: "Download MP4 (Standar)", url: sdUrl, quality: "sd", type: "mp4" });
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
    links: [{ label: "Download MP4", url: json.url, quality: "sd", type: "mp4" }],
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
