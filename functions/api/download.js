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

async function queryCustomExtractor(endpoint, targetUrl, apiKey = "") {
  const cleanEndpoint = endpoint.replace(/\/+$/, "");
  const headers = {
    "Accept": "application/json",
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Api-Key ${apiKey}`;
  }

  const [hdRes, sdRes, mp3Res] = await Promise.allSettled([
    fetch(cleanEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: targetUrl, videoQuality: "720" }),
    }),
    fetch(cleanEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: targetUrl, videoQuality: "360" }),
    }),
    fetch(cleanEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: targetUrl, downloadMode: "audio", audioFormat: "mp3" }),
    }),
  ]);

  const links = [];
  let title = "7D Media Download";
  let cover = "";
  let duration = "";
  let author = null;
  let lastUpstreamError = "";

  const parseSide = async (settled) => {
    if (settled.status !== "fulfilled") return null;
    const res = settled.value;
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      if (json?.detail) lastUpstreamError = String(json.detail);
      else lastUpstreamError = `HTTP ${res.status} dari server ekstraktor`;
      return null;
    }
    return json;
  };

  const hd = await parseSide(hdRes);
  const sd = await parseSide(sdRes);
  const mp3 = await parseSide(mp3Res);

  const meta = hd || sd || mp3;
  if (meta) {
    if (meta.filename) title = meta.filename.replace(/\.[a-z0-9]+$/i, "");
    if (meta.cover) cover = meta.cover;
    if (meta.duration) duration = formatDuration(meta.duration);
    if (meta.author) author = { name: meta.author };
  }

  if (hd?.url?.startsWith("https://")) {
    links.push({ label: "Download MP4 HD (720p)", url: hd.url, quality: "hd", type: "mp4" });
  }
  if (sd?.url?.startsWith("https://") && sd.url !== hd?.url) {
    links.push({ label: "Download MP4 (Standar)", url: sd.url, quality: "sd", type: "mp4" });
  }
  if (mp3?.url?.startsWith("https://")) {
    links.push({ label: "Download Audio (M4A / MP3)", url: mp3.url, quality: "audio", type: "mp3" });
  }

  if (links.length) {
    return { data: { title, cover, duration, author, links }, error: "" };
  }
  return { data: null, error: lastUpstreamError };
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
    let result = null;
    let upstreamError = "";

    if (env.EXTRACTOR_API_URL) {
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
