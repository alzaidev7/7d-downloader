import { guardActionAgainstAdblock, saveLocalHistory } from "../app.js?v=4";

let pendingHdUrl = null;
let hdCountdownTimer = null;
let hdReadyToDownload = false;
let jsZipMod = null;

// Anti-spam rate limiter state
let downloadCountWindow = 0;
let cooldownUntil = 0;
let cooldownInterval = null;

// Pulihkan URL jika browser sempat nyangkut di /null
if (typeof window !== "undefined" && window.location.pathname === "/null") {
  window.history.replaceState(null, "", "/");
}

async function getJSZip() {
  if (jsZipMod) return jsZipMod;
  const mod = await import("https://esm.sh/jszip@3.10.1");
  jsZipMod = mod.default || mod;
  return jsZipMod;
}

function extractFirstHttpsUrl(text) {
  const match = String(text || "").match(/https:\/\/[^\s"'<>]+/);
  return match ? match[0] : null;
}

function sanitizeDownloaderError(rawMsg, targetUrl) {
  const msg = String(rawMsg || "").trim();
  const lowerUrl = String(targetUrl || "").toLowerCase();
  const cleaned = msg.replace(/^YouTube:\s*/i, "").trim();

  if (lowerUrl.includes("instagram.com")) {
    if (/tidak tersedia|unavailable|private|login|rate|429|403|tidak dapat diambil/i.test(cleaned)) {
      return "Instagram: Media tidak dapat diambil (postingan privat atau sedang dibatasi sementara oleh Instagram).";
    }
    return cleaned ? `Instagram: ${cleaned}` : "Instagram: Gagal mengambil media. Pastikan postingan bersifat publik.";
  }

  if (lowerUrl.includes("facebook.com") || lowerUrl.includes("fb.watch")) {
    return cleaned ? `Facebook: ${cleaned}` : "Facebook: Gagal mengambil media. Pastikan video bersifat publik.";
  }

  return cleaned || "Gagal memproses tautan. Pastikan postingan bersifat publik.";
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

function isVideoMediaUrl(url) {
  const clean = String(url || "").split("?")[0].toLowerCase();
  return clean.endsWith(".mp4") || clean.endsWith(".mov") || clean.includes("/video/");
}

async function triggerDirectFileDownload(url, fallbackFilename) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("CORS");
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = fallbackFilename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
  } catch {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

async function fetchTikTokClientSide(cleanUrl) {
  try {
    const api = `https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}&hd=1`;
    const res = await fetch(api);
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.code !== 0 || !json?.data) return null;

    const d = json.data;
    const rawImages = Array.isArray(d.images) ? d.images : [];
    const slides = rawImages
      .map((item, idx) => {
        const mediaUrl = typeof item === "string" ? item : item?.url || item?.play || "";
        const liveVideoUrl =
          typeof item === "object" && item?.video_url?.startsWith("https://")
            ? item.video_url
            : isVideoMediaUrl(mediaUrl)
            ? mediaUrl
            : "";
        if (!mediaUrl.startsWith("https://")) return null;
        return {
          index: idx + 1,
          url: mediaUrl,
          liveVideoUrl,
          isLive: Boolean(liveVideoUrl),
        };
      })
      .filter(Boolean);

    const links = [];

    if (slides.length > 0) {
      // Pada Photo Slideshow TikTok, d.play adalah audio MP3, sehingga hanya tampilkan MP3 Audio Original
      if (d.music?.startsWith("https://")) {
        links.push({
          label: "Download MP3 (Audio Original)",
          url: d.music,
          quality: "audio",
          type: "mp3",
        });
      }
    } else {
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
    }

    if (!links.length && !slides.length) return null;

    return {
      ok: true,
      title: d.title || (slides.length ? "TikTok Photo Slideshow" : "TikTok Video"),
      cover: slides.length ? "" : d.cover || d.origin_cover || "",
      duration: slides.length ? "" : formatDuration(d.duration),
      author: {
        name: d.author?.nickname || "TikTok Creator",
        username: d.author?.unique_id ? `@${d.author.unique_id}` : "",
        avatar: d.author?.avatar || "",
      },
      stats: {
        likes: formatCompactNumber(d.digg_count),
        comments: formatCompactNumber(d.comment_count),
        shares: formatCompactNumber(d.share_count),
      },
      slides,
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

  function syncPasteOrClearButton() {
    if (!btnPaste) return;
    const hasValue = urlInput.value.trim().length > 0;
    if (hasValue) {
      btnPaste.textContent = "Hapus";
      btnPaste.style.background = "rgba(239, 68, 68, 0.18)";
      btnPaste.style.color = "#f87171";
      btnPaste.style.borderColor = "rgba(239, 68, 68, 0.4)";
    } else {
      btnPaste.textContent = "Paste";
      btnPaste.style.background = "";
      btnPaste.style.color = "";
      btnPaste.style.borderColor = "";
    }
  }

  function startAntiSpamCooldown(seconds, isPenalty15s) {
    cooldownUntil = Date.now() + seconds * 1000;
    if (cooldownInterval) clearInterval(cooldownInterval);

    const updateBtn = () => {
      const rem = Math.ceil((cooldownUntil - Date.now()) / 1000);
      if (rem > 0) {
        btnRun.disabled = true;
        btnRun.textContent = isPenalty15s
          ? `Batas 3x tercapai — Tunggu ${rem} detik...`
          : `Tunggu ${rem} detik...`;
      } else {
        clearInterval(cooldownInterval);
        cooldownInterval = null;
        if (isPenalty15s) {
          downloadCountWindow = 0;
        }
        btnRun.disabled = false;
        btnRun.textContent = "Download";
      }
    };

    updateBtn();
    cooldownInterval = setInterval(updateBtn, 500);
  }

  urlInput.addEventListener("input", syncPasteOrClearButton);
  urlInput.addEventListener("change", syncPasteOrClearButton);
  syncPasteOrClearButton();

  btnPaste?.addEventListener("click", async (e) => {
    e.preventDefault();
    if (urlInput.value.trim().length > 0) {
      urlInput.value = "";
      urlInput.setAttribute("value", "");
      if (resultBox) {
        resultBox.innerHTML = "";
        resultBox.classList.add("hidden");
      }
      syncPasteOrClearButton();
      urlInput.focus();
      return;
    }

    try {
      const clip = await navigator.clipboard.readText();
      const extracted = extractFirstHttpsUrl(clip);
      urlInput.value = extracted || clip.trim();
      syncPasteOrClearButton();
    } catch {
      urlInput.focus();
      alert("Izinkan akses clipboard atau tempel tautan secara manual.");
    }
  });

  function resetHdModalState() {
    if (hdCountdownTimer) {
      clearInterval(hdCountdownTimer);
      hdCountdownTimer = null;
    }
    hdReadyToDownload = false;
    pendingHdUrl = null;
    if (btnTriggerHd) {
      btnTriggerHd.disabled = false;
      btnTriggerHd.textContent = "Tonton Iklan & Buka HD";
    }
  }

  btnCloseHd?.addEventListener("click", () => {
    resetHdModalState();
    hdModal?.classList.add("hidden");
  });

  btnTriggerHd?.addEventListener("click", async () => {
    if (!pendingHdUrl) return;

    // Jika hitung mundur 15 detik sudah selesai, klik tombol ini langsung mengunduh file HD (aman dari blokir pop-up Chrome HP)
    if (hdReadyToDownload) {
      const targetUrl = pendingHdUrl;
      resetHdModalState();
      hdModal?.classList.add("hidden");
      await triggerDirectFileDownload(targetUrl, `7d-video-hd-${Date.now()}.mp4`);
      return;
    }

    if (typeof window.trigger7DAdSlot5 === "function") {
      window.trigger7DAdSlot5();
    }

    let sec = 15;
    btnTriggerHd.disabled = true;
    btnTriggerHd.textContent = `Menyiapkan HD (${sec} detik)...`;

    hdCountdownTimer = setInterval(() => {
      sec -= 1;
      if (sec > 0) {
        btnTriggerHd.textContent = `Menyiapkan HD (${sec} detik)...`;
      } else {
        clearInterval(hdCountdownTimer);
        hdCountdownTimer = null;
        hdReadyToDownload = true;
        btnTriggerHd.disabled = false;
        btnTriggerHd.textContent = "Unduh MP4 HD Sekarang";
      }
    }, 1000);
  });

  function renderDownloadResult(data) {
    resultBox.innerHTML = "";
    resultBox.classList.remove("hidden");

    const hasSlides = Array.isArray(data.slides) && data.slides.length > 0;

    const card = document.createElement("div");
    card.style.cssText =
      "background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;";

    if (!hasSlides && data.cover) {
      const mediaWrap = document.createElement("div");
      mediaWrap.style.cssText =
        "position:relative;width:100%;aspect-ratio:16/10;background:#0a0a0c;overflow:hidden;user-select:none;";

      const imgEl = document.createElement("img");
      imgEl.src = data.cover;
      imgEl.alt = "Thumbnail Preview";
      imgEl.draggable = false;
      imgEl.addEventListener("contextmenu", (e) => e.preventDefault());
      imgEl.style.cssText =
        "width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;";
      mediaWrap.appendChild(imgEl);

      if (data.duration) {
        const badge = document.createElement("span");
        badge.textContent = data.duration;
        badge.style.cssText =
          "position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.75);color:#fff;font-size:0.75rem;font-weight:700;padding:3px 8px;border-radius:8px;pointer-events:none;";
        mediaWrap.appendChild(badge);
      }

      card.appendChild(mediaWrap);
    }

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
          "width:44px;height:44px;border-radius:50%;object-fit:cover;border:1px solid rgba(255,255,255,0.15);flex-shrink:0;";
        authorRow.appendChild(avatar);
      }

      const metaCol = document.createElement("div");
      metaCol.style.cssText = "min-width:0;flex:1;";

      const nameEl = document.createElement("div");
      nameEl.style.cssText =
        "font-weight:700;font-size:0.96rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      nameEl.textContent = data.author.name;
      metaCol.appendChild(nameEl);

      if (data.author.username) {
        const userEl = document.createElement("div");
        userEl.style.cssText = "font-size:0.8rem;opacity:0.68;margin-top:1px;";
        userEl.textContent = data.author.username;
        metaCol.appendChild(userEl);
      }

      if (data.stats && (data.stats.likes || data.stats.comments || data.stats.shares)) {
        const statsEl = document.createElement("div");
        statsEl.style.cssText =
          "display:flex;gap:12px;font-size:0.78rem;opacity:0.75;margin-top:3px;";
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

    if (data.title) {
      const titleEl = document.createElement("p");
      titleEl.className = "dl-title";
      titleEl.style.cssText =
        "font-size:0.86rem;line-height:1.45;opacity:0.9;margin:0 0 14px 0;word-break:break-word;";
      titleEl.textContent = data.title;
      bodyWrap.appendChild(titleEl);
    }

    const listWrap = document.createElement("div");
    listWrap.style.cssText = "display:flex;flex-direction:column;gap:10px;";

    if (hasSlides) {
      const btnZip = document.createElement("button");
      btnZip.type = "button";
      btnZip.className = "btn-emerald full";
      btnZip.style.padding = "12px";
      btnZip.textContent = `Download all items as ZIP (${data.slides.length} Slide HD)`;

      btnZip.addEventListener("click", async () => {
        if (!guardActionAgainstAdblock()) return;
        if (typeof window.trigger7DAdSlot5 === "function") {
          window.trigger7DAdSlot5();
        }

        const origText = btnZip.textContent;
        btnZip.disabled = true;
        btnZip.textContent = "Menyiapkan arsip ZIP...";

        try {
          const JSZip = await getJSZip();
          const zip = new JSZip();

          await Promise.all(
            data.slides.map(async (slide) => {
              const targetUrl = slide.liveVideoUrl || slide.url;
              const ext = slide.isLive ? "mp4" : "jpg";
              const resp = await fetch(targetUrl);
              if (!resp.ok) return;
              const blob = await resp.blob();
              const num = String(slide.index).padStart(2, "0");
              zip.file(`7d-slide-${num}.${ext}`, blob);
            })
          );

          const zipBlob = await zip.generateAsync({ type: "blob" });
          const zipUrl = URL.createObjectURL(zipBlob);
          const a = document.createElement("a");
          a.href = zipUrl;
          a.download = `7d-slides-${Date.now()}.zip`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(zipUrl), 6000);
        } catch {
          alert("Gagal membuat ZIP otomatis. Silakan unduh masing-masing slide di bawah.");
        } finally {
          btnZip.disabled = false;
          btnZip.textContent = origText;
        }
      });

      listWrap.appendChild(btnZip);
    }

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

      btn.addEventListener("click", async () => {
        if (!guardActionAgainstAdblock()) return;
        if (item.quality === "hd") {
          resetHdModalState();
          pendingHdUrl = item.url;
          hdModal?.classList.remove("hidden");
        } else {
          if (typeof window.trigger7DAdSlot5 === "function") {
            window.trigger7DAdSlot5();
          }
          const ext = item.type === "mp3" ? "mp3" : "mp4";
          await triggerDirectFileDownload(item.url, `7d-media-${Date.now()}.${ext}`);
        }
      });

      listWrap.appendChild(btn);
    });

    bodyWrap.appendChild(listWrap);

    if (hasSlides) {
      const slidesContainer = document.createElement("div");
      slidesContainer.style.cssText =
        "display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;margin-top:16px;";

      data.slides.forEach((slide) => {
        const sCard = document.createElement("div");
        sCard.style.cssText =
          "background:rgba(0,0,0,0.28);border:1px solid rgba(255,255,255,0.1);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;";

        const thumbBox = document.createElement("div");
        thumbBox.style.cssText =
          "position:relative;width:100%;aspect-ratio:3/4;background:#09090b;overflow:hidden;user-select:none;";

        const numBadge = document.createElement("span");
        numBadge.textContent = String(slide.index);
        numBadge.style.cssText =
          "position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.75);color:#fff;font-size:0.75rem;font-weight:800;padding:3px 9px;border-radius:8px;z-index:2;pointer-events:none;";
        thumbBox.appendChild(numBadge);

        if (slide.isLive) {
          const liveBadge = document.createElement("span");
          liveBadge.textContent = "LIVE";
          liveBadge.style.cssText =
            "position:absolute;top:8px;left:8px;background:#10b981;color:#052e16;font-size:0.7rem;font-weight:800;padding:2px 7px;border-radius:6px;z-index:2;pointer-events:none;";
          thumbBox.appendChild(liveBadge);
        }

        const resBadge = document.createElement("span");
        resBadge.style.cssText =
          "position:absolute;bottom:8px;left:8px;background:rgba(0,0,0,0.72);color:#fff;font-size:0.72rem;font-weight:600;padding:2px 7px;border-radius:6px;z-index:2;pointer-events:none;display:none;";
        thumbBox.appendChild(resBadge);

        if (isVideoMediaUrl(slide.url)) {
          const posterPlaceholder = document.createElement("div");
          posterPlaceholder.style.cssText =
            "width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:700;opacity:0.85;";
          posterPlaceholder.textContent = `Live Photo #${slide.index} (MP4)`;
          thumbBox.appendChild(posterPlaceholder);
        } else {
          const img = document.createElement("img");
          img.src = slide.url;
          img.alt = `Slide ${slide.index}`;
          img.loading = "lazy";
          img.draggable = false;
          img.addEventListener("contextmenu", (e) => e.preventDefault());
          img.addEventListener("load", () => {
            if (img.naturalWidth && img.naturalHeight) {
              resBadge.textContent = `${img.naturalWidth}x${img.naturalHeight}`;
              resBadge.style.display = "inline-block";
            }
          });
          img.style.cssText =
            "width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;";
          thumbBox.appendChild(img);
        }

        sCard.appendChild(thumbBox);

        const sActionWrap = document.createElement("div");
        sActionWrap.style.cssText = "padding:10px;display:flex;flex-direction:column;gap:6px;";

        const btnSlide = document.createElement("button");
        btnSlide.type = "button";
        btnSlide.className = "btn-emerald full";
        btnSlide.style.cssText = "padding:10px;font-size:0.84rem;";
        btnSlide.textContent = slide.isLive
          ? `Download Live Photo #${slide.index}`
          : "Download this slide";

        btnSlide.addEventListener("click", async () => {
          if (!guardActionAgainstAdblock()) return;
          if (typeof window.trigger7DAdSlot5 === "function") {
            window.trigger7DAdSlot5();
          }
          const target = slide.liveVideoUrl || slide.url;
          const ext = slide.isLive ? "mp4" : "jpg";
          await triggerDirectFileDownload(target, `7d-slide-${slide.index}.${ext}`);
        });

        sActionWrap.appendChild(btnSlide);
        sCard.appendChild(sActionWrap);
        slidesContainer.appendChild(sCard);
      });

      bodyWrap.appendChild(slidesContainer);
    }

    card.appendChild(bodyWrap);
    resultBox.appendChild(card);
  }

  btnRun.addEventListener("click", async () => {
    if (!guardActionAgainstAdblock()) return;

    // Cek apakah masih dalam masa jeda anti-spam
    if (Date.now() < cooldownUntil) {
      return;
    }

    const cleanUrl = extractFirstHttpsUrl(urlInput.value);
    if (!cleanUrl) {
      return alert("Tempel tautan video/foto yang valid (https://...) terlebih dahulu.");
    }
    urlInput.value = cleanUrl;
    syncPasteOrClearButton();

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
        if (!data?.ok && data?.directFallback) {
          const fb = data.directFallback;
          const headers = { "Accept": "application/json", "Content-Type": "application/json" };
          if (fb.apiKey) headers["Authorization"] = "Api-Key " + fb.apiKey;
          const directRes = await fetch(fb.endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({ url: fb.url }),
          });
          const directJson = await directRes.json().catch(() => null);
          if (!directRes.ok || !directJson?.links?.length) {
            throw new Error(directJson?.detail || "Gagal mengambil media dari server ekstraktor.");
          }
          data = directJson;
        } else if (!res.ok || !data?.ok) {
          throw new Error(data?.error || "Gagal mengambil tautan media.");
        }
      }

      renderDownloadResult(data);
      saveLocalHistory("downloader", data.title || cleanUrl, cleanUrl);
    } catch (err) {
      alert(sanitizeDownloaderError(err.message, cleanUrl));
    } finally {
      downloadCountWindow += 1;
      if (downloadCountWindow > 3) {
        // Lebih dari 3x download -> jeda 15 detik
        startAntiSpamCooldown(15, true);
      } else {
        // Jeda standar 10 detik antar download
        startAntiSpamCooldown(10, false);
      }
    }
  });
}
