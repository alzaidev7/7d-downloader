import { guardActionAgainstAdblock, saveLocalHistory } from "../app.js?v=4";

let pendingHdUrl = null;

function extractFirstHttpsUrl(text) {
  const match = String(text || "").match(/https:\/\/[^\s"'<>]+/);
  return match ? match[0] : null;
}

function formatCompactNumber(num) {
  const n = Number(num);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function formatDuration(sec) {
  const s = Math.floor(Number(sec) || 0);
  if (s <= 0) return null;
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

async function fetchTikTokClientSide(cleanUrl) {
  try {
    const api = `https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}&hd=1`;
    const res = await fetch(api);
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.code !== 0 || !json?.data) return null;

    const d = json.data;
    const links = [];
    if (d.hdplay?.startsWith("https://")) {
      links.push({
        label: "Download MP4 HD (No Watermark)",
        url: d.hdplay,
        quality: "hd",
        type: "mp4",
      });
    }
    if (d.play?.startsWith("https://")) {
      links.push({
        label: "Download MP4 (Standar)",
        url: d.play,
        quality: "sd",
        type: "mp4",
      });
    }
    if (d.music?.startsWith("https://")) {
      links.push({
        label: "Download MP3 (Audio Original)",
        url: d.music,
        quality: "audio",
        type: "mp3",
      });
    }

    if (!links.length) return null;
    return {
      ok: true,
      title: d.title || "TikTok Video",
      cover: d.cover || d.origin_cover || "",
      previewVideo: d.play || "",
      duration: formatDuration(d.duration),
      author: {
        name: d.author?.nickname || d.author?.unique_id || "TikTok Creator",
        avatar: d.author?.avatar || "",
      },
      stats: {
        likes: formatCompactNumber(d.digg_count),
        comments: formatCompactNumber(d.comment_count),
        shares: formatCompactNumber(d.share_count),
      },
      links,
    };
  } catch {
    return null;
  }
}

export function initDownloaderModule() {
  const urlInput = document.getElementById("dlUrlInput");
  const btnPaste = document.getElementById("btnPasteUrl");
  const btnRun = document.getElementById("btnDownloadRun");
  const resultBox = document.getElementById("dlResultBox");

  const hdModal = document.getElementById("hdGateModal");
  const btnTriggerHd = document.getElementById("btnTriggerHdAd");
  const btnCloseHd = document.getElementById("btnCloseHdGate");

  if (!urlInput || !btnRun) return;

  btnPaste?.addEventListener("click", async () => {
    try {
      const clip = await navigator.clipboard.readText();
      const extracted = extractFirstHttpsUrl(clip);
      urlInput.value = extracted || clip.trim();
    } catch {
      urlInput.focus();
      alert("Izinkan akses clipboard atau tempel tautan secara manual.");
    }
  });

  btnCloseHd?.addEventListener("click", () => {
    pendingHdUrl = null;
    hdModal?.classList.add("hidden");
  });

  btnTriggerHd?.addEventListener("click", () => {
    if (!pendingHdUrl) return;
    if (typeof window.trigger7DAdSlot5 === "function") {
      window.trigger7DAdSlot5();
    }

    let sec = 5;
    btnTriggerHd.disabled = true;
    btnTriggerHd.textContent = `Membuka HD dalam ${sec} detik...`;

    const timer = setInterval(() => {
      sec -= 1;
      if (sec > 0) {
        btnTriggerHd.textContent = `Membuka HD dalam ${sec} detik...`;
      } else {
        clearInterval(timer);
        btnTriggerHd.disabled = false;
        btnTriggerHd.textContent = "Tonton Iklan & Buka HD";
        hdModal?.classList.add("hidden");
        window.open(pendingHdUrl, "_blank", "noopener,noreferrer");
        pendingHdUrl = null;
      }
    }, 1000);
  });

  function renderDownloadResult(data) {
    resultBox.innerHTML = "";
    resultBox.classList.remove("hidden");

    const card = document.createElement("div");
    card.style.cssText =
      "background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;";

    // 1. Area Preview Media (Video / Thumbnail + Durasi)
    const videoSrc =
      data.previewVideo ||
      (data.links || []).find((l) => l.type === "mp4")?.url ||
      "";

    if (data.cover || videoSrc) {
      const mediaWrap = document.createElement("div");
      mediaWrap.style.cssText =
        "position:relative;width:100%;aspect-ratio:16/10;background:#0a0a0c;overflow:hidden;";

      if (videoSrc) {
        const videoEl = document.createElement("video");
        videoEl.src = videoSrc;
        if (data.cover) videoEl.poster = data.cover;
        videoEl.controls = true;
        videoEl.playsInline = true;
        videoEl.preload = "metadata";
        videoEl.style.cssText = "width:100%;height:100%;object-fit:contain;display:block;";
        mediaWrap.appendChild(videoEl);
      } else if (data.cover) {
        const imgEl = document.createElement("img");
        imgEl.src = data.cover;
        imgEl.alt = "Preview Video";
        imgEl.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
        mediaWrap.appendChild(imgEl);
      }

      if (data.duration) {
        const badge = document.createElement("span");
        badge.textContent = data.duration;
        badge.style.cssText =
          "position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.72);color:#fff;font-size:0.75rem;font-weight:700;padding:3px 8px;border-radius:8px;pointer-events:none;";
        mediaWrap.appendChild(badge);
      }

      card.appendChild(mediaWrap);
    }

    // 2. Area Info Kreator, Statistik & Caption
    const bodyWrap = document.createElement("div");
    bodyWrap.style.cssText = "padding:14px;";

    if (data.author?.name) {
      const authorRow = document.createElement("div");
      authorRow.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:10px;";

      if (data.author.avatar) {
        const avatar = document.createElement("img");
        avatar.src = data.author.avatar;
        avatar.alt = data.author.name;
        avatar.style.cssText =
          "width:42px;height:42px;border-radius:50%;object-fit:cover;border:1px solid rgba(255,255,255,0.15);flex-shrink:0;";
        authorRow.appendChild(avatar);
      }

      const metaCol = document.createElement("div");
      metaCol.style.cssText = "min-width:0;flex:1;";

      const nameEl = document.createElement("div");
      nameEl.style.cssText =
        "font-weight:700;font-size:0.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      nameEl.textContent = data.author.name;
      metaCol.appendChild(nameEl);

      if (data.stats && (data.stats.likes || data.stats.comments || data.stats.shares)) {
        const statsEl = document.createElement("div");
        statsEl.style.cssText =
          "display:flex;gap:12px;font-size:0.78rem;opacity:0.75;margin-top:2px;";
        const parts = [];
        if (data.stats.likes) parts.push(`♥ ${data.stats.likes}`);
        if (data.stats.comments) parts.push(`💬 ${data.stats.comments}`);
        if (data.stats.shares) parts.push(`↗ ${data.stats.shares}`);
        statsEl.textContent = parts.join("   ");
        metaCol.appendChild(statsEl);
      }

      authorRow.appendChild(metaCol);
      bodyWrap.appendChild(authorRow);
    }

    const titleEl = document.createElement("p");
    titleEl.className = "dl-title";
    titleEl.style.cssText =
      "font-size:0.86rem;line-height:1.45;opacity:0.9;margin:0 0 14px 0;word-break:break-word;";
    titleEl.textContent = data.title || "Media Siap Diunduh";
    bodyWrap.appendChild(titleEl);

    // 3. Daftar Tombol Download
    const listWrap = document.createElement("div");
    listWrap.style.cssText = "display:flex;flex-direction:column;gap:10px;";

    (data.links || []).forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        item.quality === "hd"
          ? "btn-emerald full"
          : item.type === "mp3"
          ? "btn-ghost-sm full dl-btn-row mp3"
          : "btn-ghost-sm full";
      btn.style.padding = "12px";
      btn.textContent = item.label;

      btn.addEventListener("click", () => {
        if (!guardActionAgainstAdblock()) return;
        if (item.quality === "hd") {
          pendingHdUrl = item.url;
          hdModal?.classList.remove("hidden");
        } else {
          window.open(item.url, "_blank", "noopener,noreferrer");
        }
      });

      listWrap.appendChild(btn);
    });

    bodyWrap.appendChild(listWrap);
    card.appendChild(bodyWrap);
    resultBox.appendChild(card);
  }

  btnRun.addEventListener("click", async () => {
    if (!guardActionAgainstAdblock()) return;

    const cleanUrl = extractFirstHttpsUrl(urlInput.value);
    if (!cleanUrl) {
      return alert("Tempel tautan video yang valid (https://...) terlebih dahulu.");
    }
    urlInput.value = cleanUrl;

    const oldLabel = btnRun.textContent;
    btnRun.disabled = true;
    btnRun.textContent = "Memproses tautan...";
    resultBox.classList.add("hidden");

    try {
      let data = null;

      if (cleanUrl.includes("tiktok.com")) {
        data = await fetchTikTokClientSide(cleanUrl);
      }

      if (!data) {
        const res = await fetch("/api/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: cleanUrl }),
        });
        data = await res.json();
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || "Gagal mengambil tautan media.");
        }
      }

      renderDownloadResult(data);
      saveLocalHistory("downloader", data.title || cleanUrl, cleanUrl);
    } catch (err) {
      alert(err.message || "Gagal memproses video. Pastikan video bersifat publik.");
    } finally {
      btnRun.disabled = false;
      btnRun.textContent = oldLabel;
    }
  });
}
