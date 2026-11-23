import { guardActionAgainstAdblock, saveLocalHistory } from "../app.js?v=7";

export function initQrModule() {
  const modeBtns = document.querySelectorAll(".sub-pill");
  const textModeBox = document.getElementById("qrTextMode");
  const photoModeBox = document.getElementById("qrPhotoMode");
  const textInput = document.getElementById("qrTextInput");
  const btnGenerate = document.getElementById("btnQrGenerate");
  const photoInput = document.getElementById("qrPhotoInput");
  const previewWrap = document.getElementById("qrPreviewWrap");
  const qrContainer = document.getElementById("qrCanvasContainer");
  const btnPng = document.getElementById("btnQrDlPng");
  const btnSvg = document.getElementById("btnQrDlSvg");

  let qrInstance = null;

  function renderQrCode(dataValue, labelTitle) {
    if (!window.QRCodeStyling) {
      alert("Library QR sedang dimuat, coba klik lagi dalam 1 detik.");
      return;
    }

    qrContainer.innerHTML = "";
    qrInstance = new window.QRCodeStyling({
      width: 240,
      height: 240,
      type: "canvas",
      data: dataValue,
      dotsOptions: { color: "#09090b", type: "rounded" },
      backgroundOptions: { color: "#ffffff" },
      cornersSquareOptions: { type: "extra-rounded", color: "#10b981" },
    });

    qrInstance.append(qrContainer);
    previewWrap.classList.remove("hidden");
    saveLocalHistory("qr", labelTitle, dataValue);
  }

  // Switch sub-mode Text/URL vs Photo-to-QR
  modeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      modeBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const mode = btn.dataset.qrmode;
      textModeBox.classList.toggle("hidden", mode !== "text");
      photoModeBox.classList.toggle("hidden", mode !== "photo");
      previewWrap.classList.add("hidden");
    });
  });

  // Mode 1: Text / URL
  btnGenerate.addEventListener("click", () => {
    if (!guardActionAgainstAdblock()) return;
    const val = textInput.value.trim();
    if (!val) return alert("Masukkan teks atau URL terlebih dahulu.");
    renderQrCode(val, val.slice(0, 30));
  });

  // Mode 2: Photo-to-QR (Upload ke Backend KV)
  photoInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!guardActionAgainstAdblock()) {
      photoInput.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      photoInput.value = "";
      return alert("Ukuran foto maksimal 5 MB.");
    }

    const dropTitle = photoModeBox.querySelector(".drop-title");
    const originalText = dropTitle.textContent;
    dropTitle.textContent = "Mengunggah foto ke cloud...";

    try {
      const formData = new FormData();
      formData.append("photo", file);

      const res = await fetch("/api/upload-qr", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Gagal mengunggah foto.");
      }

      renderQrCode(json.photoUrl, `Foto: ${file.name.slice(0, 20)}`);
    } catch (err) {
      alert(err.message);
    } finally {
      dropTitle.textContent = originalText;
      photoInput.value = "";
    }
  });

  btnPng.addEventListener("click", () => {
    if (qrInstance && guardActionAgainstAdblock()) {
      qrInstance.download({ name: `7d-qr-${Date.now()}`, extension: "png" });
    }
  });

  btnSvg.addEventListener("click", () => {
    if (qrInstance && guardActionAgainstAdblock()) {
      qrInstance.download({ name: `7d-qr-${Date.now()}`, extension: "svg" });
    }
  });
}
