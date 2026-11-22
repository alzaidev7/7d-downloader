import { guardActionAgainstAdblock, saveLocalHistory } from "../app.js?v=4";

let pendingHdUrl = null;

function extractFirstHttpsUrl(text) {
  const match = String(text || "").match(/https:\/\/[^\s"'<>]+/);
  return match ? match[0] : null;
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
      cover: d.cover || "",
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

    const titleEl = document.createElement("p");
    titleEl.className = "dl-title";
    titleEl.style.cssText = "font-weight:700;margin-bottom:12px;font-size:0.95rem;";
    titleEl.textContent = data.title || "Media Siap Diunduh";
    resultBox.appendChild(titleEl);

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

    resultBox.appendChild(listWrap);
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

      // 1. Jika TikTok, ambil langsung via IP perangkat (anti blokir datacenter)
      if (cleanUrl.includes("tiktok.com")) {
        data = await fetchTikTokClientSide(cleanUrl);
      }

      // 2. Jalur Backend untuk YouTube, Instagram, Facebook, atau cadangan TikTok
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
