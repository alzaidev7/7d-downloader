// Konfigurasi Direct Link HilltopAds / Monetag untuk 7D - Downloader
(function () {
  const DIRECT_LINK_URL = "https://plump-plastic.com/b/3.Vi0/Pm3bpUvvbSmxV/J/ZZDW0S3-NMjKUHyhNJD/Yp5OLNT/ck2qNPTBIp0fNhzBMt";

  window.trigger7DAdSlot5 = function () {
    if (!DIRECT_LINK_URL || DIRECT_LINK_URL.includes("GANTI_DENGAN")) return;
    try {
      window.open(DIRECT_LINK_URL, "_blank", "noopener,noreferrer");
    } catch {
      const a = document.createElement("a");
      a.href = DIRECT_LINK_URL;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  };
})();
