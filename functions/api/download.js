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

function resolveProxyUrl(rawUrl, baseOrigin) {
  if (!rawUrl) return "";
  const clean = decodeHtmlEntities(rawUrl).trim();
  if (clean.startsWith("https://")) return clean;
  if (clean.startsWith("//")) return `https:${clean}`;
  if (clean.startsWith("/")) return `${baseOrigin}${clean}`;
  return "";
}

async function fetchInstagramEmbedCarousel(shortcode) {
  const embedUrls = [
    `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
    `https://www.instagram.com/p/${shortcode}/embed/`,
  ];

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.instagram.com/",
  };

  for (const target of embedUrls) {
    try {
      const res = await fetch(target, { redirect: "follow", headers });
      if (!res.ok) continue;
      const html = await res.text();

      const slideUrls = [];
      const seen = new Set();
      const addSlide = (raw) => {
        if (!raw) return;
        const clean = decodeHtmlEntities(decodeJsonString(raw));
        if (
          clean.startsWith("https://") &&
          !seen.has(clean) &&
          !/s150x150|s320x320|profile_pic|static\.cdninstagram\.com/i.test(clean)
        ) {
          seen.add(clean);
          slideUrls.push(clean);
        }
      };

      for (const m of html.matchAll(/"display_url"\s*:\s*"(https:[^"]+)"/g)) {
        addSlide(m[1]);
      }
      for (const m of html.matchAll(/<img[^>]+class="EmbeddedMediaImage"[^>]+src=["'](https:\/\/[^"']+)["']/gi)) {
        addSlide(m[1]);
      }

      if (slideUrls.length > 0) {
        const userMatch = html.match(/class="UsernameText"[^>]*>([^<]+)</i);
        const authorName = userMatch ? decodeHtmlEntities(userMatch[1]).trim() : "Instagram Creator";
        const capMatch = html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/i);
        const title = capMatch
          ? decodeHtmlEntities(capMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim().slice(0, 180)
          : "Instagram Photo Post";

        return {
          title: title || "Instagram Photo Post",
          cover: "",
          author: {
            name: authorName,
            username: authorName.startsWith("@") ? authorName : `@${authorName}`,
          },
          slides: slideUrls.map((u, idx) => ({
            index: idx + 1,
            url: u,
            liveVideoUrl: "",
            isLive: false,
          })),
          links: [],
        };
      }
    } catch {
      // Lanjut
    }
  }
  return null;
}

async function fetchInstagramViaInstaFix(shortcode, kind) {
  const hosts = [
    "https://www.ddinstagram.com",
    "https://www.kkinstagram.com",
    "https://www.eeinstagram.com",
  ];

  for (const base of hosts) {
    try {
      const target = `${base}/${kind}/${shortcode}/`;
      const res = await fetch(target, {
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!res.ok) continue;
      const html = await res.text();

      const ogVidMatch =
        html.match(/<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+name=["']twitter:player:stream["'][^>]+content=["']([^"']+)["']/i);
      const rawVideoUrl = ogVidMatch ? resolveProxyUrl(ogVidMatch[1], base) : "";
      // Abaikan URL /grid/ karena itu adalah thumbnail grid untuk postingan foto carousel, bukan video
      const isRealVideo = rawVideoUrl && !/\/grid\//i.test(rawVideoUrl);

      const ogImgMatches = [
        ...html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/gi),
      ];
      const imageUrls = [
        ...new Set(
          ogImgMatches
            .map((m) => resolveProxyUrl(m[1], base))
            .filter((u) => u && !/favicon|logo|banner|\/grid\//i.test(u))
        ),
      ];

      // Cek juga apakah proxy menautkan slide gambar langsung (/images/shortcode/1, /2, dst)
      for (const m of html.matchAll(/["'](\/images\/[^"']+)["']/gi)) {
        const resolved = resolveProxyUrl(m[1], base);
        if (resolved && !imageUrls.includes(resolved)) {
          imageUrls.push(resolved);
        }
      }

      const titleMatch =
        html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
      const authorMatch = html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i);

      const authorRaw = authorMatch ? decodeHtmlEntities(authorMatch[1]).trim() : "Instagram Creator";
      const authorName = authorRaw.replace(/^@/, "") || "Instagram Creator";
      const authorUser = authorRaw.startsWith("@") ? authorRaw : `@${authorName}`;
      const title = titleMatch ? decodeHtmlEntities(titleMatch[1]).trim().slice(0, 180) : "Instagram Media";

      // 1. Jika benar-benar video / Reels
      if (isRealVideo) {
        return {
          title: title || "Instagram Video",
          cover: imageUrls[0] || "",
          author: { name: authorName, username: authorUser },
          links: [
            {
              label: "Download MP4 HD",
              url: rawVideoUrl,
              quality: "hd",
              type: "mp4",
            },
          ],
        };
      }

      // 2. Jika postingan foto / carousel (/p/)
      if (kind === "p") {
        // Coba ambil seluruh slide dari embed Instagram terlebih dahulu agar carousel lengkap
        const embedCarousel = await fetchInstagramEmbedCarousel(shortcode);
        if (embedCarousel && embedCarousel.slides.length >= imageUrls.length) {
          return {
            ...embedCarousel,
            title: title || embedCarousel.title,
            author: { name: authorName, username: authorUser },
          };
        }

        if (imageUrls.length > 0) {
          return {
            title: title || "Instagram Photo Post",
            cover: "",
            author: { name: authorName, username: authorUser },
            slides: imageUrls.map((u, idx) => ({
              index: idx + 1,
              url: u,
              liveVideoUrl: "",
              isLive: false,
            })),
            links: [],
          };
        }
      }
    } catch {
      // Coba host berikutnya
    }
  }

  return null;
}

async function fetchInstagramDirect(parsedUrl) {
  const pathMatch = parsedUrl.pathname.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  if (!pathMatch) return null;

  const rawType = pathMatch[1].toLowerCase();
  const kind = rawType === "p" ? "p" : "reel";
  const shortcode = pathMatch[2];

  const proxyResult = await fetchInstagramViaInstaFix(shortcode, kind);
  if (proxyResult) return proxyResult;

  if (kind === "p") {
    const embedResult = await fetchInstagramEmbedCarousel(shortcode);
    if (embedResult) return embedResult;
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
        // Lanjut ke jalur cadangan
      }
    }

    // 2. Jalur cadangan Instagram & Facebook
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
