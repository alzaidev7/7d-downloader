import * as AppHelpers from "../app.js?v=9";
const guardActionAgainstAdblock = AppHelpers.guardActionAgainstAdblock || (() => true);
const saveLocalHistory = AppHelpers.saveLocalHistory || (() => {});

let srPipelinePromise = null;

async function getSuperResPipeline(onProgress) {
  if (!srPipelinePromise) {
    srPipelinePromise = (async () => {
      const { pipeline, env } = await import(
        "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.1.2"
      );
      env.allowLocalModels = false;
      return await pipeline("image-to-image", "Xenova/swin2SR-lightweight-x2-64", {
        progress_callback: (info) => {
          if (info?.status === "progress" && typeof info.progress === "number" && onProgress) {
            onProgress(Math.min(95, Math.round(info.progress)));
          }
        },
      });
    })().catch((err) => {
      srPipelinePromise = null;
      throw err;
    });
  }
  return srPipelinePromise;
}

function applyUnsharpAndClarity(ctx, width, height, sharpnessPct, clarityPct) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const src = imgData.data;
  const out = new Uint8ClampedArray(src.length);

  const amount = (sharpnessPct / 100) * 1.45;
  const contrast = 1 + (clarityPct / 100) * 0.26;
  const w4 = width * 4;

  for (let y = 0; y < height; y++) {
    const yUp = Math.max(0, y - 1) * w4;
    const yMid = y * w4;
    const yDn = Math.min(height - 1, y + 1) * w4;

    for (let x = 0; x < width; x++) {
      const xLt = Math.max(0, x - 1) * 4;
      const xMid = x * 4;
      const xRt = Math.min(width - 1, x + 1) * 4;
      const idx = yMid + xMid;

      for (let c = 0; c < 3; c++) {
        const center = src[idx + c];
        const blur =
          (src[yUp + xMid + c] +
            src[yDn + xMid + c] +
            src[yMid + xLt + c] +
            src[yMid + xRt + c]) *
          0.25;

        let val = center + (center - blur) * amount;
        val = (val - 128) * contrast + 128;
        out[idx + c] = val < 0 ? 0 : val > 255 ? 255 : val;
      }
      out[idx + 3] = src[idx + 3];
    }
  }

  imgData.data.set(out);
  ctx.putImageData(imgData, 0, 0);
}

function stepUpscaleCanvas(sourceCanvas, targetW, targetH) {
  let curCanvas = sourceCanvas;
  let curW = sourceCanvas.width;
  let curH = sourceCanvas.height;

  while (curW * 2 < targetW && curH * 2 < targetH) {
    const nextW = curW * 2;
    const nextH = curH * 2;
    const stepC = document.createElement("canvas");
    stepC.width = nextW;
    stepC.height = nextH;
    const sCtx = stepC.getContext("2d");
    sCtx.imageSmoothingEnabled = true;
    sCtx.imageSmoothingQuality = "high";
    sCtx.drawImage(curCanvas, 0, 0, nextW, nextH);
    curCanvas = stepC;
    curW = nextW;
    curH = nextH;
  }

  const finalC = document.createElement("canvas");
  finalC.width = targetW;
  finalC.height = targetH;
  const fCtx = finalC.getContext("2d");
  fCtx.imageSmoothingEnabled = true;
  fCtx.imageSmoothingQuality = "high";
  fCtx.drawImage(curCanvas, 0, 0, targetW, targetH);
  return finalC;
}

function openHdAdGate(onComplete) {
  let modal = document.getElementById("upAdGateModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "upAdGateModal";
    modal.style.cssText =
      "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.82);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:18px;";
    modal.innerHTML = `
      <div style="width:100%;max-width:360px;background:#141418;border:1px solid rgba(255,255,255,0.14);border-radius:18px;padding:18px;text-align:center;color:#fff;box-shadow:0 18px 45px rgba(0,0,0,0.65);">
        <div style="font-size:0.75rem;font-weight:700;color:#10b981;letter-spacing:0.5px;margin-bottom:4px;">7D ULTRA HD EXPORT</div>
        <h3 style="margin:0 0 6px 0;font-size:1.05rem;">Menyiapkan Foto HD Anda...</h3>
        <p style="margin:0 0 12px 0;font-size:0.8rem;opacity:0.72;">Unduhan otomatis dimulai setelah hitungan sponsor selesai.</p>
        <div id="upAdGateBanner" style="min-height:90px;border-radius:12px;background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.14);display:flex;align-items:center;justify-content:center;margin-bottom:14px;font-size:0.75rem;opacity:0.65;">
          Sponsor / Iklan 7D
        </div>
        <button type="button" id="btnUpAdGateAction" disabled style="width:100%;padding:11px;border-radius:12px;border:none;background:#10b981;color:#052e16;font-weight:800;font-size:0.88rem;cursor:pointer;">
          Tunggu 20 detik...
        </button>
      </div>
    `;
    document.body.appendChild(modal);
  }

  modal.style.display = "flex";
  const btn = document.getElementById("btnUpAdGateAction");
  let sec = 20;
  btn.disabled = true;
  btn.style.opacity = "0.65";
  btn.textContent = `Menyiapkan HD (${sec}d)...`;

  const timer = setInterval(() => {
    sec -= 1;
    if (sec > 0) {
      btn.textContent = `Menyiapkan HD (${sec}d)...`;
    } else {
      clearInterval(timer);
      btn.disabled = false;
      btn.style.opacity = "1";
      btn.textContent = "Unduh Foto HD Sekarang";
      modal.style.display = "none";
      onComplete();
    }
  }, 1000);

  btn.onclick = () => {
    if (btn.disabled) return;
    clearInterval(timer);
    modal.style.display = "none";
    onComplete();
  };
}

export function initUpscalerModule() {
  const fileInput = document.getElementById("upFileInput");
  const dropZone = document.getElementById("upUploadDrop");
  const editorWrap = document.getElementById("upEditorWrap");
  const compareBox = document.getElementById("upCompareBox");
  const canvasAfter = document.getElementById("upCanvasAfter");
  const canvasBefore = document.getElementById("upCanvasBefore");
  const sliderHandle = document.getElementById("upSliderHandle");
  const infoBadge = document.getElementById("upResBadge");
  const loadingOverlay = document.getElementById("upSparkleOverlay");

  if (!fileInput || !canvasAfter || !canvasBefore) return;

  let originalBitmap = null;
  let originalFileName = "photo";
  let scaleFactor = 2;
  let presetMode = "ultrahd"; // "original" | "ultrahd" | "uhdai"
  let sharpnessVal = 62;
  let clarityVal = 40;
  let splitRatio = 0.5;
  let isSliding = false;
  let baseAiCanvas = null;

  function updateSplitPosition(clientX) {
    if (!compareBox || presetMode === "original") return;
    const rect = compareBox.getBoundingClientRect();
    if (!rect.width) return;
    const rel = (clientX - rect.left) / rect.width;
    splitRatio = Math.max(0.02, Math.min(0.98, rel));
    const pct = (splitRatio * 100).toFixed(2);
    canvasBefore.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    if (sliderHandle) {
      sliderHandle.style.left = `${pct}%`;
    }
  }

  compareBox?.addEventListener("pointerdown", (e) => {
    isSliding = true;
    compareBox.setPointerCapture?.(e.pointerId);
    updateSplitPosition(e.clientX);
  });
  compareBox?.addEventListener("pointermove", (e) => {
    if (!isSliding) return;
    updateSplitPosition(e.clientX);
  });
  compareBox?.addEventListener("pointerup", () => {
    isSliding = false;
  });
  compareBox?.addEventListener("pointercancel", () => {
    isSliding = false;
  });

  async function renderEnhancedResult() {
    if (!originalBitmap) return;

    const statusEl = document.getElementById("upStatusText");
    const btnDownload = document.getElementById("btnUpDownload");
    if (btnDownload) btnDownload.disabled = true;
    if (loadingOverlay) loadingOverlay.style.display = "flex";

    const origW = originalBitmap.width;
    const origH = originalBitmap.height;
    const activeScale = presetMode === "original" ? 1 : scaleFactor;
    const targetW = Math.min(3840, origW * activeScale);
    const targetH = Math.min(3840, origH * activeScale);

    canvasBefore.width = targetW;
    canvasBefore.height = targetH;
    const bCtx = canvasBefore.getContext("2d");
    bCtx.imageSmoothingEnabled = false;
    bCtx.drawImage(originalBitmap, 0, 0, targetW, targetH);

    canvasAfter.width = targetW;
    canvasAfter.height = targetH;
    const aCtx = canvasAfter.getContext("2d");

    try {
      if (presetMode === "original") {
        aCtx.drawImage(originalBitmap, 0, 0, targetW, targetH);
        canvasBefore.style.clipPath = "inset(0 100% 0 0)";
        if (sliderHandle) sliderHandle.style.display = "none";
        if (statusEl) statusEl.textContent = "Menampilkan foto asli tanpa peningkatan";
      } else if (presetMode === "uhdai") {
        if (!baseAiCanvas) {
          if (statusEl) statusEl.textContent = "Memuat AI UHD Super-Resolution...";
          const sr = await getSuperResPipeline((pct) => {
            if (statusEl) statusEl.textContent = `Mengunduh model UHD AI (${pct}%)...`;
          });
          if (statusEl) statusEl.textContent = "Merekonstruksi piksel UHD AI...";

          const aiInScale = Math.min(1, 512 / Math.max(origW, origH));
          const aiW = Math.max(32, Math.round(origW * aiInScale));
          const aiH = Math.max(32, Math.round(origH * aiInScale));
          const tempIn = document.createElement("canvas");
          tempIn.width = aiW;
          tempIn.height = aiH;
          tempIn.getContext("2d").drawImage(originalBitmap, 0, 0, aiW, aiH);

          const outRaw = await sr(tempIn.toDataURL("image/png"));
          baseAiCanvas = outRaw.toCanvas();
        }

        const upscaledAi = stepUpscaleCanvas(baseAiCanvas, targetW, targetH);
        aCtx.drawImage(upscaledAi, 0, 0, targetW, targetH);
        applyUnsharpAndClarity(aCtx, targetW, targetH, Math.round(sharpnessVal * 0.72), clarityVal);

        if (sliderHandle) sliderHandle.style.display = "block";
        canvasBefore.style.clipPath = `inset(0 ${100 - splitRatio * 100}% 0 0)`;
        if (statusEl) statusEl.textContent = "Peningkat Kualitas - UHD AI • Geser untuk membandingkan";
      } else {
        if (statusEl) statusEl.textContent = "Memproses Peningkat Kualitas - Ultra HD...";
        await new Promise((r) => setTimeout(r, 120));

        const srcC = document.createElement("canvas");
        srcC.width = origW;
        srcC.height = origH;
        srcC.getContext("2d").drawImage(originalBitmap, 0, 0);

        const upscaled = stepUpscaleCanvas(srcC, targetW, targetH);
        aCtx.drawImage(upscaled, 0, 0, targetW, targetH);
        applyUnsharpAndClarity(aCtx, targetW, targetH, sharpnessVal, clarityVal);

        if (sliderHandle) sliderHandle.style.display = "block";
        canvasBefore.style.clipPath = `inset(0 ${100 - splitRatio * 100}% 0 0)`;
        if (statusEl) statusEl.textContent = "Peningkat Kualitas - Ultra HD • Geser untuk membandingkan";
      }

      if (infoBadge) {
        infoBadge.textContent =
          presetMode === "original"
            ? `${origW}×${origH} (Asli)`
            : `${origW}×${origH} → ${targetW}×${targetH} (${scaleFactor}x HD)`;
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = "Gagal memproses: " + err.message;
    } finally {
      if (loadingOverlay) loadingOverlay.style.display = "none";
      if (btnDownload) btnDownload.disabled = false;
    }
  }

  fileInput.addEventListener("change", async (e) => {
    if (!guardActionAgainstAdblock()) return;
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 6 * 1024 * 1024) {
      alert("Ukuran foto maksimal 6 MB.");
      return;
    }

    originalFileName = file.name.replace(/\.[^.]+$/, "") || "photo";
    originalBitmap = await createImageBitmap(file);
    baseAiCanvas = null;
    presetMode = "ultrahd";

    document.querySelectorAll("[data-wink-mode]").forEach((b) => {
      b.classList.toggle("active", b.dataset.winkMode === "ultrahd");
    });

    dropZone?.classList.add("hidden");
    if (editorWrap) {
      editorWrap.classList.remove("hidden");
      editorWrap.style.display = "flex";
    }

    await renderEnhancedResult();
    saveLocalHistory("upscaler", file.name, `${scaleFactor}x Ultra HD`);
  });

  document.getElementById("btnUpChangePhoto")?.addEventListener("click", () => {
    fileInput.value = "";
    fileInput.click();
  });

  document.getElementById("btnUpToggleIntensity")?.addEventListener("click", () => {
    const panel = document.getElementById("upIntensityPanel");
    if (!panel) return;
    const isHidden = panel.style.display === "none" || !panel.style.display;
    panel.style.display = isHidden ? "flex" : "none";
  });

  document.querySelectorAll("[data-wink-mode]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll("[data-wink-mode]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      presetMode = btn.dataset.winkMode || "ultrahd";
      await renderEnhancedResult();
    });
  });

  document.querySelectorAll("[data-upscale-factor]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll("[data-upscale-factor]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      scaleFactor = Number(btn.dataset.upscaleFactor) || 2;
      if (presetMode === "original") presetMode = "ultrahd";
      await renderEnhancedResult();
    });
  });

  document.getElementById("upSharpRange")?.addEventListener("input", (e) => {
    sharpnessVal = Number(e.target.value);
  });
  document.getElementById("upSharpRange")?.addEventListener("change", renderEnhancedResult);

  document.getElementById("upClarityRange")?.addEventListener("input", (e) => {
    clarityVal = Number(e.target.value);
  });
  document.getElementById("upClarityRange")?.addEventListener("change", renderEnhancedResult);

  document.getElementById("btnUpDownload")?.addEventListener("click", () => {
    if (!guardActionAgainstAdblock() || !canvasAfter.width) return;

    // Trigger direct link pengiklan jika tersedia
    if (typeof window.trigger7DAdSlot5 === "function") {
      window.trigger7DAdSlot5();
    }

    const triggerFileDownload = () => {
      const a = document.createElement("a");
      a.href = canvasAfter.toDataURL("image/png");
      a.download = `7d-ultrahd-${scaleFactor}x-${originalFileName}.png`;
      a.click();
    };

    // Pakai Ad-Gate 5 detik dari app.js jika tersedia, atau modal Ad-Gate HD bawaan
    openHdAdGate(triggerFileDownload);
  });
}
