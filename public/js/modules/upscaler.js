import { guardActionAgainstAdblock, saveLocalHistory } from "../app.js?v=4";

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

  const amount = (sharpnessPct / 100) * 1.35;
  const contrast = 1 + (clarityPct / 100) * 0.24;
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

export function initUpscalerModule() {
  const fileInput = document.getElementById("upFileInput");
  const dropZone = document.getElementById("upUploadDrop");
  const editorWrap = document.getElementById("upEditorWrap");
  const compareBox = document.getElementById("upCompareBox");
  const canvasAfter = document.getElementById("upCanvasAfter");
  const canvasBefore = document.getElementById("upCanvasBefore");
  const sliderHandle = document.getElementById("upSliderHandle");
  const infoBadge = document.getElementById("upResBadge");

  if (!fileInput || !canvasAfter || !canvasBefore) return;

  let originalBitmap = null;
  let originalFileName = "photo";
  let scaleFactor = 2;
  let enhanceMode = "instant"; // "instant" | "ai"
  let sharpnessVal = 55;
  let clarityVal = 35;
  let splitRatio = 0.5;
  let isSliding = false;
  let baseAiCanvas = null;

  function updateSplitPosition(clientX) {
    if (!compareBox) return;
    const rect = compareBox.getBoundingClientRect();
    if (!rect.width) return;
    const rel = (clientX - rect.left) / rect.width;
    splitRatio = Math.max(0.03, Math.min(0.97, rel));
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

    const origW = originalBitmap.width;
    const origH = originalBitmap.height;
    const targetW = Math.min(3840, origW * scaleFactor);
    const targetH = Math.min(3840, origH * scaleFactor);

    canvasBefore.width = targetW;
    canvasBefore.height = targetH;
    const bCtx = canvasBefore.getContext("2d");
    bCtx.imageSmoothingEnabled = false;
    bCtx.drawImage(originalBitmap, 0, 0, targetW, targetH);

    canvasAfter.width = targetW;
    canvasAfter.height = targetH;
    const aCtx = canvasAfter.getContext("2d");

    try {
      if (enhanceMode === "ai") {
        if (!baseAiCanvas) {
          if (statusEl) statusEl.textContent = "Memuat model AI Super-Resolution...";
          const sr = await getSuperResPipeline((pct) => {
            if (statusEl) statusEl.textContent = `Mengunduh AI Enhancer (${pct}%)...`;
          });
          if (statusEl) statusEl.textContent = "Merekonstruksi detail piksel AI...";

          // Batasi input AI max 512px agar cepat & aman di memori browser HP
          const aiInScale = Math.min(1, 512 / Math.max(origW, origH));
          const aiW = Math.max(32, Math.round(origW * aiInScale));
          const aiH = Math.max(32, Math.round(origH * aiInScale));
          const tempIn = document.createElement("canvas");
          tempIn.width = aiW;
          tempIn.height = aiH;
          tempIn.getContext("2d").drawImage(originalBitmap, 0, 0, aiW, aiH);

          const dataUrl = tempIn.toDataURL("image/png");
          const outRaw = await sr(dataUrl);
          const aiCanvas = outRaw.toCanvas();
          baseAiCanvas = aiCanvas;
        }

        const upscaledAi = stepUpscaleCanvas(baseAiCanvas, targetW, targetH);
        aCtx.drawImage(upscaledAi, 0, 0, targetW, targetH);
        applyUnsharpAndClarity(aCtx, targetW, targetH, Math.round(sharpnessVal * 0.7), clarityVal);
      } else {
        if (statusEl) statusEl.textContent = "Meningkatkan ketajaman HD...";
        const srcC = document.createElement("canvas");
        srcC.width = origW;
        srcC.height = origH;
        srcC.getContext("2d").drawImage(originalBitmap, 0, 0);

        const upscaled = stepUpscaleCanvas(srcC, targetW, targetH);
        aCtx.drawImage(upscaled, 0, 0, targetW, targetH);
        applyUnsharpAndClarity(aCtx, targetW, targetH, sharpnessVal, clarityVal);
      }

      if (infoBadge) {
        infoBadge.textContent = `${origW}×${origH} → ${targetW}×${targetH} (${scaleFactor}x HD)`;
      }
      if (statusEl) {
        statusEl.textContent = "Geser garis tengah untuk membandingkan Before / After";
      }
      canvasBefore.style.clipPath = `inset(0 ${100 - splitRatio * 100}% 0 0)`;
    } catch (err) {
      if (statusEl) statusEl.textContent = "Gagal memproses AI: " + err.message;
    } finally {
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

    dropZone?.classList.add("hidden");
    if (editorWrap) { editorWrap.classList.remove("hidden"); editorWrap.style.display = "flex"; }

    await renderEnhancedResult();
    saveLocalHistory("upscaler", file.name, `${scaleFactor}x HD Enhancer`);
  });

  document.getElementById("btnUpChangePhoto")?.addEventListener("click", () => {
    fileInput.value = "";
    fileInput.click();
  });

  document.querySelectorAll("[data-upscale-factor]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll("[data-upscale-factor]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      scaleFactor = Number(btn.dataset.upscaleFactor) || 2;
      await renderEnhancedResult();
    });
  });

  document.querySelectorAll("[data-upscale-mode]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll("[data-upscale-mode]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      enhanceMode = btn.dataset.upscaleMode || "instant";
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
    if (typeof window.trigger7DAdSlot5 === "function") {
      window.trigger7DAdSlot5();
    }
    const a = document.createElement("a");
    a.href = canvasAfter.toDataURL("image/png");
    a.download = `7d-hd-${scaleFactor}x-${originalFileName}.png`;
    a.click();
  });
}
