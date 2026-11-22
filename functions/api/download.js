const ALLOWED_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
  "tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
  "instagram.com", "www.instagram.com",
  "facebook.com", "www.facebook.com", "m.facebook.com", "fb.watch",
]);

function parseAllowedUrl(raw) {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function fetchTikTokMedia(targetUrl) {
  const form = new URLSearchParams();
  form.set("url", targetUrl);
  form.set("hd", "1");

  const res = await fetch("https://www.tikwm.com/api/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0",
    },
    body: form.toString(),
  });

  if (!res.ok) return null;
  const json = await res.json();
  if (json?.code !== 0 || !json?.data) return null;

  const d = json.data;
  const links = [];

  if (d.hdplay && d.hdplay.startsWith("https://")) {
    links.push({
      label: "Download MP4 HD (No Watermark)",
      url: d.hdplay,
      quality: "hd",
      type: "mp4",
    });
  }
  if (d.play && d.play.startsWith("https://")) {
    links.push({
      label: "Download MP4 (No Watermark)",
      url: d.play,
      quality: "sd",
      type: "mp4",
    });
  }
  if (d.music && d.music.startsWith("https://")) {
    links.push({
      label: "Download MP3 (Audio Original)",
      url: d.music,
      quality: "audio",
      type: "mp3",
    });
  }

  return links.length ? { title: d.title || "TikTok Video", links } : null;
}

async function fetchViaCustomCobalt(targetUrl, env) {
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
    const parsed = parseAllowedUrl(String(body?.url || "").trim());

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
      result = await fetchTikTokMedia(fullUrl);
    }

    if (!result) {
      result = await fetchViaCustomCobalt(fullUrl, env);
    }

    if (!result) {
      return Response.json(
        {
          ok: false,
          error: host.includes("tiktok.com")
            ? "Video TikTok tidak ditemukan atau bersifat privat."
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
