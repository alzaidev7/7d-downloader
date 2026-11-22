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

async function queryCobaltNode(endpoint, targetUrl, apiKey = "") {
  const headers = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
  };
  if (apiKey) {
    headers["Authorization"] = `Api-Key ${apiKey}`;
  }

  const [hdRes, sdRes, mp3Res] = await Promise.allSettled([
    fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: targetUrl, videoQuality: "720" }),
    }),
    fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: targetUrl, videoQuality: "360" }),
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
      if (hd.filename) title = hd.filename.replace(/\.[a-z0-9]+$/i, "");
      links.push({ label: "Download MP4 HD (720p)", url: hd.url, quality: "hd", type: "mp4" });
    }
  }
  if (sdRes.status === "fulfilled" && sdRes.value.ok) {
    const sd = await sdRes.value.json().catch(() => null);
    if (sd?.url?.startsWith("https://")) {
      if (title === "7D Media Download" && sd.filename) {
        title = sd.filename.replace(/\.[a-z0-9]+$/i, "");
      }
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

async function queryOceanSaverYouTube(canonicalUrl) {
  const fetchFormat = async (format) => {
    const initUrl = `https://p.oceansaver.in/ajax/download.php?copyright=0&format=${format}&url=${encodeURIComponent(canonicalUrl)}`;
    const res = await fetch(initUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    const initData = await res.json().catch(() => null);
    if (!initData?.success || !initData?.id) return null;

    if (initData.download_url?.startsWith("https://")) {
      return { title: initData.title, url: initData.download_url };
    }

    // Polling singkat maksimal 4 kali (total ~4 detik)
    const progressUrl = `https://p.oceansaver.in/ajax/progress.php?id=${encodeURIComponent(initData.id)}`;
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const pRes = await fetch(progressUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!pRes.ok) continue;
      const pData = await pRes.json().catch(() => null);
      if (pData?.download_url?.startsWith("https://")) {
        return { title: initData.title, url: pData.download_url };
      }
      if (pData?.success === 1 && !pData?.download_url) break;
    }
    return null;
  };

  const [hd, sd, mp3] = await Promise.all([
    fetchFormat("720"),
    fetchFormat("360"),
    fetchFormat("mp3"),
  ]);

  const links = [];
  const title = hd?.title || sd?.title || mp3?.title || "YouTube Video";

  if (hd?.url) links.push({ label: "Download MP4 HD (720p)", url: hd.url, quality: "hd", type: "mp4" });
  if (sd?.url) links.push({ label: "Download MP4 (360p)", url: sd.url, quality: "sd", type: "mp4" });
  if (mp3?.url) links.push({ label: "Download MP3 (Audio)", url: mp3.url, quality: "audio", type: "mp3" });

  return links.length ? { title, links } : null;
}

async function fetchYouTubeDirect(parsed) {
  const videoId = extractYouTubeId(parsed);
  if (!videoId) return null;
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Jalur 1: Public Cobalt Nodes dengan PO-Token
  const cobaltNodes = [
    "https://cobalt-api.meowing.de/",
    "https://capi.3kh0.net/",
    "https://cobalt.api.timelessnesses.me/",
    "https://api.kektube.com/",
  ];

  for (const node of cobaltNodes) {
    try {
      const res = await queryCobaltNode(node, canonicalUrl);
      if (res) return res;
    } catch {
      continue;
    }
  }

  // Jalur 2: OceanSaver Extractor
  try {
    const oceanRes = await queryOceanSaverYouTube(canonicalUrl);
    if (oceanRes) return oceanRes;
  } catch {
    // lanjut ke fallback berikutnya
  }

  return null;
}

// ==========================================
// 2. EKSTRAKTOR INSTAGRAM (REELS, SHARE & POST)
// ==========================================
async function fetchInstagramDirect(parsed) {
  let targetPath = parsed.pathname;

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
      // gunakan path awal jika gagal redirect
    }
  }

  const match = targetPath.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  if (!match) return null;
  const shortcode = match[2];
  const canonicalIg = `https://www.instagram.com/reel/${shortcode}/`;

  // Jalur 1: Embed OpenGraph Resolver (tahan blokir login wall)
  const embedMirrors = [
    `https://d.ddinstagram.com/reel/${shortcode}/`,
    `https://www.kkinstagram.com/reel/${shortcode}/`,
  ];

  for (const mirrorUrl of embedMirrors) {
    try {
      const res = await fetch(mirrorUrl, {
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
          "Accept": "text/html,application/xhtml+xml",
        },
      });
      if (!res.ok) continue;
      const html = await res.text();

      const ogVideo =
        html.match(/<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video["']/i);

      if (ogVideo) {
        let videoUrl = decodeHtmlEntities(ogVideo[1]);
        if (videoUrl.startsWith("/")) {
          videoUrl = new URL(mirrorUrl).origin + videoUrl;
        }
        if (videoUrl.startsWith("https://")) {
          const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
          const title = ogTitle ? decodeHtmlEntities(ogTitle[1]) : `Instagram Video (${shortcode})`;
          return {
            title,
            links: [
              { label: "Download MP4 HD (No Watermark)", url: videoUrl, quality: "hd", type: "mp4" },
              { label: "Download MP4 (Standar)", url: videoUrl, quality: "sd", type: "mp4" },
            ],
          };
        }
      }
    } catch {
      continue;
    }
  }

  // Jalur 2: Public Cobalt Nodes untuk Instagram
  const cobaltNodes = [
    "https://cobalt-api.meowing.de/",
    "https://capi.3kh0.net/",
    "https://cobalt.api.timelessnesses.me/",
  ];

  for (const node of cobaltNodes) {
    try {
      const res = await queryCobaltNode(node, canonicalIg);
      if (res) return res;
    } catch {
      continue;
    }
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

  const ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i); const cover = ogImg ? decodeHtmlEntities(ogImg[1]) : ""; return { title, cover, links };
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

    if (env.EXTRACTOR_API_URL) {
      result = await queryCobaltNode(env.EXTRACTOR_API_URL, fullUrl, env.EXTRACTOR_API_KEY || "");
    }

    if (!result) {
      if (host.includes("youtube.com") || host === "youtu.be") {
        result = await fetchYouTubeDirect(parsed);
      } else if (host.includes("instagram.com")) {
        result = await fetchInstagramDirect(parsed);
      } else if (host.includes("facebook.com") || host === "fb.watch") {
        result = await fetchFacebookDirect(fullUrl);
      }
    }

    if (!result) {
      return Response.json(
        {
          ok: false,
          error: "Video tidak dapat diambil. Pastikan akun/postingan bersifat publik atau coba beberapa saat lagi.",
        },
        { status: 502 }
      );
    }

    return Response.json({ ok: true, ...result });
  } catch {
    return Response.json({ ok: false, error: "Terjadi kesalahan pada server downloader." }, { status: 500 });
  }
}
