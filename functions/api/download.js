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

function extractYoutubeId(parsedUrl) {
  const host = parsedUrl.hostname.toLowerCase();
  if (host === "youtu.be") {
    return parsedUrl.pathname.replace(/^\/+/, "").split("/")[0] || null;
  }
  if (parsedUrl.pathname.startsWith("/shorts/")) {
    return parsedUrl.pathname.split("/")[2] || null;
  }
  return parsedUrl.searchParams.get("v");
}

function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&#x26;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/g, '"');
}

function decodeJsonString(raw) {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw.replace(/\\\//g, "/").replace(/\\u0026/g, "&");
  }
}

function formatDuration(sec) {
  const s = Math.floor(Number(sec) || 0);
  if (s <= 0) return "";
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

async function fetchYoutubeNoLogin(fullUrl, videoId) {
  // 1. Jalur Cobalt Community Instances (tanpa login/cookies)
  const cobaltInstances = [
    "https://cobalt-api.kwiatekmiki.com",
    "https://cobalt.api.timelessnesses.me",
    "https://api.cobalt.tools",
  ];

  for (const base of cobaltInstances) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5500);

      const [vidRes, audRes] = await Promise.allSettled([
        fetch(base, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: fullUrl,
            videoQuality: "720",
            filenameStyle: "basic",
          }),
        }),
        fetch(base, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: fullUrl,
            downloadMode: "audio",
            audioFormat: "mp3",
          }),
        }),
      ]);
      clearTimeout(timer);

      const links = [];
      let title = "YouTube Video";

      if (vidRes.status === "fulfilled" && vidRes.value.ok) {
        const vJson = await vidRes.value.json().catch(() => null);
        if (vJson?.url?.startsWith("https://")) {
          if (vJson.filename) title = vJson.filename.replace(/\.[a-z0-9]+$/i, "");
          links.push({
            label: "Download MP4 HD (720p)",
            url: vJson.url,
            quality: "hd",
            type: "mp4",
          });
        }
      }

      if (audRes.status === "fulfilled" && audRes.value.ok) {
        const aJson = await audRes.value.json().catch(() => null);
        if (aJson?.url?.startsWith("https://")) {
          links.push({
            label: "Download Audio (MP3)",
            url: aJson.url,
            quality: "audio",
            type: "mp3",
          });
        }
      }

      if (links.length) {
        const cover = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";
        return { title, cover, links };
      }
    } catch {
      // Lanjut ke instance berikutnya
    }
  }

  // 2. Jalur Cadangan Invidious Public API (tanpa login/cookies)
  if (videoId) {
    const invidiousInstances = [
      "https://inv.nadeko.net",
      "https://invidious.nerdvpn.de",
      "https://yt.artemislena.eu",
    ];

    for (const inv of invidiousInstances) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${inv}/api/v1/videos/${encodeURIComponent(videoId)}`, {
          signal: controller.signal,
          headers: { "Accept": "application/json" },
        });
        clearTimeout(timer);

        if (!res.ok) continue;
        const data = await res.json().catch(() => null);
        if (!data) continue;

        const formatStreams = Array.isArray(data.formatStreams) ? data.formatStreams : [];
        const adaptiveFormats = Array.isArray(data.adaptiveFormats) ? data.adaptiveFormats : [];
        const links = [];

        formatStreams.sort((a, b) => parseInt(b.resolution || "0", 10) - parseInt(a.resolution || "0", 10));
        if (formatStreams[0]?.url?.startsWith("https://")) {
          links.push({
            label: `Download MP4 (${formatStreams[0].resolution || "HD"})`,
            url: formatStreams[0].url,
            quality: "hd",
            type: "mp4",
          });
        }

        const audioOnly = adaptiveFormats.find(
          (f) => f.type?.startsWith("audio/") && f.url?.startsWith("https://")
        );
        if (audioOnly) {
          links.push({
            label: "Download Audio (M4A / MP3)",
            url: audioOnly.url,
            quality: "audio",
            type: "mp3",
          });
        }

        if (links.length) {
          return {
            title: data.title || "YouTube Video",
            cover: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            duration: data.lengthSeconds ? formatDuration(data.lengthSeconds) : "",
            author: data.author ? { name: data.author } : null,
            links,
          };
        }
      } catch {
        // Lanjut ke instance berikutnya
      }
    }
  }

  return null;
}

async function queryCustomExtractor(endpoint, targetUrl, apiKey = "") {
  const cleanEndpoint = endpoint.replace(/\/+$/, "");
  const headers = {
    "Accept": "application/json",
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Api-Key ${apiKey}`;
  }

  try {
    const res = await fetch(cleanEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: targetUrl }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const errMsg = json?.detail ? String(json.detail) : `HTTP ${res.status} dari server ekstraktor`;
      return { data: null, error: errMsg };
    }

    const links = Array.isArray(json?.links)
      ? json.links.filter((l) => l?.url?.startsWith("https://"))
      : [];

    if (!links.length && json?.url?.startsWith("https://")) {
      links.push({ label: "Download MP4 HD", url: json.url, quality: "hd", type: "mp4" });
    }

    if (!links.length) {
      return { data: null, error: "Tautan media kosong" };
    }

    const title = (json.title || json.filename || "7D Media Download").replace(/\.[a-z0-9]+$/i, "");
    const cover = json.cover || "";
    const duration = json.duration ? formatDuration(json.duration) : "";
    const author = json.author ? { name: json.author } : null;

    return { data: { title, cover, duration, author, links }, error: "" };
  } catch (err) {
    return { data: null, error: err?.message || "Koneksi ke server ekstraktor gagal" };
  }
}

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

  const ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const cover = ogImg ? decodeHtmlEntities(ogImg[1]) : "";

  return { title, cover, links };
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
    const isYoutube = host.includes("youtube.com") || host === "youtu.be";
    let result = null;
    let upstreamError = "";

    if (isYoutube) {
      const videoId = extractYoutubeId(parsed);
      result = await fetchYoutubeNoLogin(fullUrl, videoId);
    }

    if (!result && env.EXTRACTOR_API_URL) {
      const custom = await queryCustomExtractor(
        env.EXTRACTOR_API_URL,
        fullUrl,
        env.EXTRACTOR_API_KEY || ""
      );
      result = custom.data;
      upstreamError = custom.error;
    }

    if (!result && (host.includes("facebook.com") || host === "fb.watch")) {
      result = await fetchFacebookDirect(fullUrl);
    }

    if (!result) {
      const detail = upstreamError ? ` (${upstreamError})` : "";
      return Response.json(
        {
          ok: false,
          error: `Video tidak dapat diambil. Pastikan postingan bersifat publik${detail}.`,
        },
        { status: 502 }
      );
    }

    return Response.json({ ok: true, ...result });
  } catch {
    return Response.json({ ok: false, error: "Terjadi kesalahan pada server downloader." }, { status: 500 });
  }
}
