import { guardActionAgainstAdblock, saveLocalHistory } from "../app.js?v=4";

export function initDownloaderModule() {
  const urlInput = document.getElementById("dlUrlInput");
  const btnPaste = document.getElementById("btnPasteUrl");
  const btnRun = document.getElementById("btnDownloadRun");
  const resultBox = document.getElementById("dlResultBox");

  const hdGateModal = document.getElementById("hdGateModal");
  const hdGateDesc = document.getElementById("hdGateDesc");
  const btnTriggerHdAd = document.getElementById("btnTriggerHdAd");
  const btnCloseHdGate = document.getElementById("btnCloseHdGate");

  let pendingHdUrl = null;
  let hdCountdownTimer = null;

  // 1. Tombol Paste Otomatis dari Clipboard
  btnPaste.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) urlInput.value = text.trim();
    } catch {
      urlInput.focus();
      alert("Izinkan akses clipboard atau tempel manual di kolom tautan.");
    }
  });

  // 2. Logika Modal Wajib Nonton Iklan untuk HD
  function openHdGate(targetUrl) {
    if (!guardActionAgainstAdblock()) return;
    pendingHdUrl = targetUrl;
    btnTriggerHdAd.disabled = false;
    btnTriggerHdAd.textContent = "Tonton Iklan & Buka HD";
    hdGateDesc.textContent =
      "Lihat iklan singkat selama 5 detik untuk membuka tautan unduhan MP4 HD Tanpa Watermark.";
    hdGateModal.classList.remove("hidden");
  }

  btnCloseHdGate.addEventListener("click", () => {
    clearInterval(hdCountdownTimer);
    pendingHdUrl = null;
    hdGateModal.classList.add("hidden");
  });

  btnTriggerHdAd.addEventListener("click", () => {
    if (!pendingHdUrl) return;
    if (!guardActionAgainstAdblock()) return;

    // Panggil Titik Iklan ke-5 (Direct Link / Vignette Monetag/HilltopAds)
    const directAdUrl = window.__7D_DIRECT_AD_URL__ || "";
    if (directAdUrl) {
      const popup = window.open(directAdUrl, "_blank", "noopener,noreferrer");
      if (!popup) {
        alert("Pop-up iklan diblokir browser. Izinkan pop-up untuk membuka kualitas HD.");
        return;
      }
    } else {
      window.dispatchEvent(new CustomEvent("7d:trigger-hd-ad"));
    }

    // Hitung mundur 5 detik sebelum file HD terbuka
    let seconds = 5;
    btnTriggerHdAd.disabled = true;
    btnTriggerHdAd.textContent = `Membuka HD dalam ${seconds} detik...`;

    clearInterval(hdCountdownTimer);
    hdCountdownTimer = setInterval(() => {
      seconds -= 1;
      if (seconds > 0) {
        btnTriggerHdAd.textContent = `Membuka HD dalam ${seconds} detik...`;
      } else {
        clearInterval(hdCountdownTimer);
        const finalUrl = pendingHdUrl;
        pendingHdUrl = null;
        hdGateModal.classList.add("hidden");
        window.open(finalUrl, "_blank", "noopener,noreferrer");
      }
    }, 1000);
  });

  // 3. Render Hasil Susun Vertikal Ala SSSTik
  function renderSafeResult(data) {
    resultBox.innerHTML = "";
    resultBox.classList.remove("hidden");

    const titleEl = document.createElement("p");
    titleEl.style.cssText = "font-weight:600; margin-top:16px; font-size:0.95rem;";
    titleEl.textContent = data.title || "Media Siap Diunduh";
    resultBox.appendChild(titleEl);

    const stack = document.createElement("div");
    stack.className = "dl-stack";

    (data.links || []).forEach((item) => {
      if (typeof item.url !== "string" || !item.url.startsWith("https://")) return;

      if (item.quality === "hd") {
        // Tombol HD wajib melewati Ad-Gate
        const btnHd = document.createElement("button");
        btnHd.type = "button";
        btnHd.className = "dl-btn-row hd";

        const labelSpan = document.createElement("span");
        labelSpan.textContent = item.label || "Download MP4 HD (No Watermark)";
        const tagSpan = document.createElement("span");
        tagSpan.className = "dl-tag";
        tagSpan.textContent = "ADS • HD";

        btnHd.append(labelSpan, tagSpan);
        btnHd.addEventListener("click", () => openHdGate(item.url));
        stack.appendChild(btnHd);
      } else {
        // Tombol MP4 Standar & MP3 langsung unduh
        const a = document.createElement("a");
        a.href = item.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.className = `dl-btn-row ${item.type === "mp3" ? "mp3" : "sd"}`;

        const labelSpan = document.createElement("span");
        labelSpan.textContent =
          item.label || (item.type === "mp3" ? "Download MP3 (Audio)" : "Download MP4");
        const tagSpan = document.createElement("span");
        tagSpan.className = "dl-tag";
        tagSpan.textContent = item.type === "mp3" ? "MP3" : "MP4";

        a.append(labelSpan, tagSpan);
        stack.appendChild(a);
      }
    });

    resultBox.appendChild(stack);
  }

  btnRun.addEventListener("click", async () => {
    if (!guardActionAgainstAdblock()) return;
    const rawUrl = urlInput.value.trim();
    const urlMatch = rawUrl.match(/https:\/\/[^\s]+/); if (!urlMatch) {
      return alert("Masukkan tautan valid yang diawali https://");
    }

    btnRun.disabled = true;
    const oldText = btnRun.textContent;
    btnRun.textContent = "Memproses...";

    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlMatch[0] }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Gagal mengekstrak media.");
      }

      renderSafeResult(json);
      saveLocalHistory("downloader", json.title || rawUrl, rawUrl);
    } catch (err) {
      alert(err.message);
    } finally {
      btnRun.disabled = false;
      btnRun.textContent = oldText;
    }
  });
}
