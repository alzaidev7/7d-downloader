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

async function fetchInstagramGraphQL(shortcode) {
  try {
    const variables = JSON.stringify({
      shortcode,
      child_comment_count: 0,
      fetch_comment_count: 0,
      parent_comment_count: 0,
      has_threaded_comments: false,
    });
    const gqlUrl = `https://www.instagram.com/graphql/query/?query_hash=b3055c01b4b222b8a47dc12b090e0e64&variables=${encodeURIComponent(variables)}`;

    const res = await fetch(gqlUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "X-IG-App-ID": "936619743392459",
        "Referer": `https://www.instagram.com/p/${shortcode}/`,
      },
    });

    if (!res.ok) return null;
    const json = await res.json();
    const media = json?.data?.shortcode_media;
    if (!media) return null;

    const ownerName = media.owner?.full_name || media.owner?.username || "Instagram Creator";
    const ownerUser = media.owner?.username ? `@${media.owner.username}` : "";
    const ownerAvatar = media.owner?.profile_pic_url || "";
    const captionEdges = media.edge_media_to_caption?.edges || [];
    const title = captionEdges[0]?.node?.text || "Instagram Media";

    // 1. Jika Video / Reels tunggal
    if (media.is_video && media.video_url?.startsWith("https://")) {
      return {
        title: title.slice(0, 180),
        cover: media.display_url || "",
        duration: media.video_duration ? formatDuration(media.video_duration) : "",
        author: { name: ownerName, username: ownerUser, avatar: ownerAvatar },
        links: [
          {
            label: "Download MP4 HD",
            url: media.video_url,
            quality: "hd",
            type: "mp4",
          },
        ],
      };
    }

    // 2. Jika Carousel (banyak slide foto/video)
    const sidecarEdges = media.edge_sidecar_to_children?.edges || [];
    if (sidecarEdges.length > 0) {
      const slides = sidecarEdges
        .map((edge, idx) => {
          const node = edge?.node;
          if (!node) return null;
          const imgUrl = node.display_url || "";
          const vidUrl = node.is_video && node.video_url?.startsWith("https://") ? node.video_url : "";
          if (!imgUrl && !vidUrl) return null;
          return {
            index: idx + 1,
            url: imgUrl || vidUrl,
            liveVideoUrl: vidUrl,
            isLive: Boolean(vidUrl),
          };
        })
        .filter(Boolean);

      if (slides.length > 0) {
        return {
          title: title.slice(0, 180),
          cover: "",
          author: { name: ownerName, username: ownerUser, avatar: ownerAvatar },
          slides,
          links: [],
        };
      }
    }

    // 3. Jika Foto tunggal
    if (media.display_url?.startsWith("https://")) {
      return {
        title: title.slice(0, 180),
        cover: "",
        author: { name: ownerName, username: ownerUser, avatar: ownerAvatar },
        slides: [{ index: 1, url: media.display_url, liveVideoUrl: "", isLive: false }],
        links: [],
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchInstagramDirect(parsedUrl) {
  const pathMatch = parsedUrl.pathname.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  if (!pathMatch) return null;

  const rawType = pathMatch[1].toLowerCase();
  const isExplicitReel = rawType === "reel" || rawType === "reels" || rawType === "tv";
  const kind = rawType === "p" ? "p" : "reel";
  const shortcode = pathMatch[2];

  // Coba jalur GraphQL shortcode_media terlebih dahulu (paling akurat untuk Reels & Carousel)
  const gqlResult = await fetchInstagramGraphQL(shortcode);
  if (gqlResult) return gqlResult;

  // Cadangan parsing halaman Embed & Web Publik
  const candidateUrls = [
    `https://www.instagram.com/${kind}/${shortcode}/embed/captioned/`,
    `https://www.instagram.com/${kind}/${shortcode}/embed/`,
    `https://www.instagram.com/${kind}/${shortcode}/`,
  ];

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
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
      for (const m of html.matchAll(/"contentUrl"\s*:\s*"(https:[^"]+\.mp4[^"]*)"/gi)) {
        addVideoUrl(m[1]);
      }
      for (const m of html.matchAll(/data-video-url=["'](https:\/\/[^"']+)["']/gi)) {
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

      if (links.length > 0) {
        return {
          title: title || "Instagram Video",
          cover,
          author: { name: authorName, username: authorName.startsWith("@") ? authorName : `@${authorName}` },
          links,
        };
      }

      if (isExplicitReel) {
        continue;
      }

      // Ekstraksi multi-foto untuk postingan /p/
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
