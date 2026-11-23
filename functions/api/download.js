const ALLOWED_HOSTS = new Set([
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
    .replace(/&#x2F;/gi, "/")
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

async function fetchFacebookDirect(fullUrl) {
  const res = await fetch(fullUrl, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
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

async function fetchInstagramDirect(parsedUrl) {
  const pathMatch = parsedUrl.pathname.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  if (!pathMatch) return null;

  const rawType = pathMatch[1].toLowerCase();
  const isExplicitReel = rawType === "reel" || rawType === "reels" || rawType === "tv";
  const kind = rawType === "p" ? "p" : "reel";
  const shortcode = pathMatch[2];

  const candidateUrls = [
    `https://www.instagram.com/${kind}/${shortcode}/embed/captioned/`,
    `https://www.instagram.com/${kind}/${shortcode}/embed/`,
    `https://www.instagram.com/${kind}/${shortcode}/`,
  ];

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.instagram.com/",
  };

  for (const target of candidateUrls) {
    try {
      const res = await fetch(target, { redirect: "follow", headers });
      if (!res.ok) continue;
      const html = await res.text();

      const links = [];
      const seenVideos = new Set();

      const addVideoUrl = (raw) => {
        if (!raw) return;
        const clean = decodeHtmlEntities(decodeJsonString(raw));
        if (clean.startsWith("https://") && !seenVideos.has(clean)) {
          seenVideos.add(clean);
          links.push({
            label: links.length === 0 ? "Download MP4 HD" : `Download MP4 (Alternatif ${links.length + 1})`,
            url: clean,
            quality: links.length === 0 ? "hd" : "sd",
            type: "mp4",
          });
        }
      };

      for (const m of html.matchAll(/"video_url"\s*:\s*"(https:[^"]+)"/g)) {
        addVideoUrl(m[1]);
      }
      for (const m of html.matchAll(/<video[^>]+src=["'](https:\/\/[^"']+)["']/gi)) {
        addVideoUrl(m[1]);
      }
      const ogVid = html.match(/<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i);
      if (ogVid) addVideoUrl(ogVid[1]);

      const ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
      const cover = ogImg ? decodeHtmlEntities(ogImg[1]) : "";

      const userMatch =
        html.match(/"username"\s*:\s*"([^"]+)"/) ||
        html.match(/class="UsernameText"[^>]*>([^<]+)</i);
      const authorName = userMatch ? decodeHtmlEntities(userMatch[1]).trim() : "Instagram Creator";

      const capMatch =
        html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/i) ||
        html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
      const title = capMatch
        ? decodeHtmlEntities(capMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim().slice(0, 180)
        : "Instagram Media";

      // Jika ditemukan video MP4
      if (links.length > 0) {
        return {
          title: title || "Instagram Video",
          cover,
          author: { name: authorName, username: authorName.startsWith("@") ? authorName : `@${authorName}` },
          links,
        };
      }

      // Jika tautan explicitly adalah /reel/ atau /reels/ dan video tidak ditemukan, JANGAN fallback ke cover foto
      if (isExplicitReel) {
        continue;
      }

      // Untuk tautan /p/ (postingan foto tunggal atau carousel multi-slide)
      const slideUrls = [];
      const seenImages = new Set();
      const addImageSlide = (raw) => {
        if (!raw) return;
        const clean = decodeHtmlEntities(decodeJsonString(raw));
        if (
          clean.startsWith("https://") &&
          !seenImages.has(clean) &&
          !/s150x150|s320x320|profile_pic/i.test(clean)
        ) {
          seenImages.add(clean);
          slideUrls.push(clean);
        }
      };

      for (const m of html.matchAll(/"display_url"\s*:\s*"(https:[^"]+)"/g)) {
        addImageSlide(m[1]);
      }
      for (const m of html.matchAll(/<img[^>]+class="EmbeddedMediaImage"[^>]+src=["'](https:\/\/[^"']+)["']/gi)) {
        addImageSlide(m[1]);
      }
      if (!slideUrls.length && cover) {
        addImageSlide(cover);
      }

      if (slideUrls.length > 0) {
        const slides = slideUrls.map((u, idx) => ({
          index: idx + 1,
          url: u,
          liveVideoUrl: "",
          isLive: false,
        }));
        return {
          title: title || "Instagram Photo Post",
          cover: "",
          author: { name: authorName, username: authorName.startsWith("@") ? authorName : `@${authorName}` },
          slides,
          links: [],
        };
      }
    } catch {
      // Lanjut ke kandidat URL berikutnya
    }
  }

  return null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const parsed = parseAllowedUrl(body?.url);

    if (!parsed) {
      return Response.json(
        { ok: false, error: "Gunakan tautan HTTPS resmi dari TikTok, Instagram, atau Facebook." },
        { status: 400 }
      );
    }

    const host = parsed.hostname.toLowerCase();
    const fullUrl = parsed.toString();
    const endpoint = (env.EXTRACTOR_API_URL || "").replace(/\/+$/, "");
    const apiKey = env.EXTRACTOR_API_KEY || "";

    let result = null;
    let upstreamError = "";

    // 1. Coba ekstraktor utama (Vercel)
    if (endpoint) {
      try {
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

        if (res.ok && json) {
          const links = Array.isArray(json.links)
            ? json.links.filter((l) => l?.url?.startsWith("https://"))
            : [];
          if (links.length) {
            result = {
              title: (json.title || "7D Media Download").replace(/\.[a-z0-9]+$/i, ""),
              cover: json.cover || "",
              duration: json.duration ? formatDuration(json.duration) : "",
              author: typeof json.author === "string" ? { name: json.author } : json.author || null,
              links,
            };
          }
        } else if (json?.detail) {
          upstreamError = ` (${String(json.detail).replace(/^YouTube:\s*/i, "")})`;
        }
      } catch {
        // Lanjut ke jalur cadangan langsung
      }
    }

    // 2. Jalur cadangan langsung dari Cloudflare Edge untuk Instagram & Facebook
    if (!result && host.includes("instagram.com")) {
      result = await fetchInstagramDirect(parsed);
    }

    if (!result && (host.includes("facebook.com") || host === "fb.watch")) {
      result = await fetchFacebookDirect(fullUrl);
    }

    if (!result) {
      return Response.json(
        { ok: false, error: `Video tidak dapat diambil. Pastikan postingan bersifat publik${upstreamError}.` },
        { status: 502 }
      );
    }

    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json(
      { ok: false, error: `Terjadi kesalahan server: ${err?.message || "unknown"}` },
      { status: 500 }
    );
  }
}
