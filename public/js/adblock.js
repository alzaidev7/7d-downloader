let lastAdRefreshAt = 0;

export function initAdSystem() {
  window.__7D_ADBLOCK_ACTIVE__ = false;

  if (window.__7D_AD_BAIT_LOADED__ !== true) {
    window.__7D_ADBLOCK_ACTIVE__ = true;
  }

  const bait = document.createElement("div");
  bait.className = "adsbox ad-slot-bait";
  bait.style.cssText = "width:1px;height:1px;position:fixed;left:-9999px;top:-9999px;pointer-events:none;";
  document.body.appendChild(bait);

  setTimeout(() => {
    const style = window.getComputedStyle(bait);
    if (
      !document.body.contains(bait) ||
      bait.offsetParent === null ||
      style.display === "none" ||
      style.visibility === "hidden"
    ) {
      window.__7D_ADBLOCK_ACTIVE__ = true;
    }
    bait.remove();
  }, 150);

  const btnReload = document.getElementById("btnReloadPage");
  if (btnReload) {
    btnReload.addEventListener("click", () => window.location.reload());
  }
}

// Dipanggil saat user berpindah tab SPA (jeda aman minimal 30 detik)
export function refreshAdSlotsOnTabSwitch() {
  if (window.__7D_ADBLOCK_ACTIVE__) return;
  const now = Date.now();
  if (now - lastAdRefreshAt < 30000) return;
  lastAdRefreshAt = now;

  // Hook siap pakai untuk memicu refresh zona iklan HilltopAds / Monetag
  window.dispatchEvent(new CustomEvent("7d:refresh-ads"));
}

// Dipanggil sebelum eksekusi tombol utama (Download / Unduh PNG / Buat QR)
export function guardActionAgainstAdblock() {
  if (window.__7D_ADBLOCK_ACTIVE__) {
    const modal = document.getElementById("adblockModal");
    if (modal) modal.classList.remove("hidden");
    return false;
  }
  // Hook titik iklan ke-5 (Vignette / Interstitial ringan setelah aksi)
  window.dispatchEvent(new CustomEvent("7d:trigger-action-ad"));
  return true;
}
