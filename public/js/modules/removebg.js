import { guardActionAgainstAdblock, saveLocalHistory } from "../app.js?v=4";

let segmenterInstance = null;

async function getFastSegmenter() {
  if (segmenterInstance) return segmenterInstance;
  const vision = await import("https://esm.sh/@mediapipe/tasks-vision@0.10.14");
  const fileset = await vision.FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  segmenterInstance = await vision.ImageSegmenter.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
      delegate: "CPU",
    },
    runningMode: "IMAGE",
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });
  return segmenterInstance;
}

export function initRemoveBgModule() {
  const fileInput = document.getElementById("bgFileInput");
  const dropZone = document.getElementById("bgUploadDrop");
  const editorWrap = document.getElementById("bgEditorWrap");
  const topTools = document.getElementById("bgTopTools");
  const canvas = document.getElementById("bgCanvasOutput");
  if (!canvas || !fileInput) return;
  const ctx = canvas.getContext("2d");

  const originalCanvas = document.createElement("canvas");
  const maskCanvas = document.createElement("canvas");
  const maskCtx = maskCanvas.getContext("2d");
  const cutoutCanvas = document.createElement("canvas");
  const cutoutCtx = cutoutCanvas.getContext("2d");

  let bgMode = "transparent";
  let bgPhotoImg = null;
  let blurAmount = 0;
  let shadowAmount = 0;
  let stickerText = "";
  let stickerColor = "#ffffff";
  let brushMode = "erase";
  let brushSize = 20;
  let isDrawing = false;
  let showOriginal = false;

  // Koordinat & status indikator lingkaran merah
  let pointerPos = null;
  let lastPos = null;
  let sizePreviewTimer = null;

  const undoStack = [];
  const redoStack = [];

  function pushMaskHistory() {
    undoStack.push(maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height));
    if (undoStack.length > 15) undoStack.shift();
    redoStack.length = 0;
  }

  function renderComposite(includeCursor = true) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (showOriginal) {
      ctx.drawImage(originalCanvas, 0, 0);
      return;
    }

    // 1. Gambar Latar Belakang
    if (bgMode === "photo" && bgPhotoImg) {
      ctx.save();
      if (blurAmount > 0) ctx.filter = `blur(${blurAmount}px)`;
      ctx.drawImage(bgPhotoImg, 0, 0, w, h);
      ctx.restore();
    } else if (bgMode !== "transparent") {
      ctx.fillStyle = bgMode;
      ctx.fillRect(0, 0, w, h);
    }

    // 2. Potong Objek Sesuai Masker
    cutoutCtx.clearRect(0, 0, w, h);
    cutoutCtx.globalCompositeOperation = "source-over";
    cutoutCtx.drawImage(originalCanvas, 0, 0);
    cutoutCtx.globalCompositeOperation = "destination-in";
    cutoutCtx.drawImage(maskCanvas, 0, 0);

    // 3. Tempel Objek + Bayangan
    ctx.save();
    if (shadowAmount > 0) {
      ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
      ctx.shadowBlur = shadowAmount;
      ctx.shadowOffsetY = Math.round(shadowAmount * 0.3);
    }
    ctx.drawImage(cutoutCanvas, 0, 0);
    ctx.restore();

    // 4. Teks Stiker Opsional
    if (stickerText) {
      ctx.save();
      const fontSize = Math.max(24, Math.round(w * 0.065));
      ctx.font = `800 ${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = stickerColor;
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = Math.max(3, Math.round(fontSize * 0.12));
      ctx.strokeText(stickerText, w / 2, h - fontSize * 0.8);
      ctx.fillText(stickerText, w / 2, h - fontSize * 0.8);
      ctx.restore();
    }

    // 5. Indikator Lingkaran Merah saat sentuhan / atur ukuran kuas
    if (includeCursor && pointerPos) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(pointerPos.x, pointerPos.y, brushSize, 0, Math.PI * 2);
      ctx.fillStyle =
        brushMode === "erase"
          ? "rgba(239, 68, 68, 0.38)"
          : "rgba(16, 185, 129, 0.35)";
      ctx.fill();
      ctx.lineWidth = Math.max(2, Math.round(w * 0.004));
      ctx.strokeStyle = brushMode === "erase" ? "#ef4444" : "#10b981";
      ctx.stroke();

      // Titik pusat presisi di tengah lingkaran
      ctx.beginPath();
      ctx.arc(pointerPos.x, pointerPos.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.restore();
    }
  }

  async function processImageFile(file) {
    if (!guardActionAgainstAdblock()) return;
    if (file.size > 4 * 1024 * 1024) {
      fileInput.value = "";
      return alert("Ukuran foto maksimal 4 MB agar proses AI cepat dan ringan.");
    }

    const titleEl = dropZone.querySelector(".drop-title");
    const oldTitle = titleEl.textContent;
    titleEl.textContent = "Memproses AI Cepat (< 1 detik)...";

    try {
      const img = await createImageBitmap(file);
      const maxDim = 1280;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      canvas.width = originalCanvas.width = maskCanvas.width = cutoutCanvas.width = w;
      canvas.height = originalCanvas.height = maskCanvas.height = cutoutCanvas.height = h;

      originalCanvas.getContext("2d").drawImage(img, 0, 0, w, h);

      const segmenter = await getFastSegmenter();
      const result = segmenter.segment(originalCanvas);
      const confidence = result.confidenceMasks[0].getAsFloat32Array();

      const maskImg = maskCtx.createImageData(w, h);
      for (let i = 0; i < confidence.length; i++) {
        const alpha = confidence[i] > 0.45 ? Math.min(255, Math.round(confidence[i] * 255)) : 0;
        const idx = i * 4;
        maskImg.data[idx] = 255;
        maskImg.data[idx + 1] = 255;
        maskImg.data[idx + 2] = 255;
        maskImg.data[idx + 3] = alpha;
      }
      maskCtx.putImageData(maskImg, 0, 0);
      result.close();

      undoStack.length = 0;
      redoStack.length = 0;
      pushMaskHistory();

      dropZone.classList.add("hidden");
      editorWrap.classList.remove("hidden");
      topTools.classList.remove("hidden");
      renderComposite(false);
      saveLocalHistory("removebg", file.name, "Studio Cutout");
    } catch (err) {
      alert("Gagal memproses gambar: " + err.message);
    } finally {
      titleEl.textContent = oldTitle;
    }
  }

  fileInput.addEventListener("change", (e) => {
    if (e.target.files?.[0]) processImageFile(e.target.files[0]);
  });

  // Tab Dock Editor
  document.querySelectorAll(".dock-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".dock-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".dock-panel").forEach((p) => p.classList.add("hidden"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.panel)?.classList.remove("hidden");
    });
  });

  // Warna & Foto Latar
  document.querySelectorAll(".swatch").forEach((sw) => {
    sw.addEventListener("click", () => {
      bgMode = sw.dataset.bg;
      renderComposite(false);
    });
  });

  document.getElementById("bgColorPicker")?.addEventListener("input", (e) => {
    bgMode = e.target.value;
    renderComposite(false);
  });

  document.getElementById("bgCustomPhoto")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    bgPhotoImg = await createImageBitmap(f);
    bgMode = "photo";
    renderComposite(false);
  });

  // Kuas Hapus / Pulihkan
  const btnErase = document.getElementById("btnBrushErase");
  const btnRestore = document.getElementById("btnBrushRestore");
  btnErase?.addEventListener("click", () => {
    brushMode = "erase";
    btnErase.classList.add("active");
    btnRestore.classList.remove("active");
  });
  btnRestore?.addEventListener("click", () => {
    brushMode = "restore";
    btnRestore.classList.add("active");
    btnErase.classList.remove("active");
  });

  // Pratinjau lingkaran merah di tengah kanvas saat slider ukuran kuas digeser
  document.getElementById("brushSizeRange")?.addEventListener("input", (e) => {
    brushSize = Number(e.target.value);
    if (canvas.width > 0) {
      pointerPos = { x: canvas.width / 2, y: canvas.height / 2 };
      renderComposite(true);
      clearTimeout(sizePreviewTimer);
      sizePreviewTimer = setTimeout(() => {
        if (!isDrawing) {
          pointerPos = null;
          renderComposite(false);
        }
      }, 600);
    }
  });

  function getCanvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function paintMaskStroke(fromPos, toPos) {
    maskCtx.save();
    maskCtx.globalCompositeOperation = brushMode === "erase" ? "destination-out" : "source-over";
    maskCtx.strokeStyle = "rgba(255,255,255,1)";
    maskCtx.fillStyle = "rgba(255,255,255,1)";
    maskCtx.lineWidth = brushSize * 2;
    maskCtx.lineCap = "round";
    maskCtx.lineJoin = "round";

    maskCtx.beginPath();
    maskCtx.moveTo(fromPos.x, fromPos.y);
    maskCtx.lineTo(toPos.x, toPos.y);
    maskCtx.stroke();

    maskCtx.beginPath();
    maskCtx.arc(toPos.x, toPos.y, brushSize, 0, Math.PI * 2);
    maskCtx.fill();
    maskCtx.restore();

    renderComposite(true);
  }

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    isDrawing = true;
    pushMaskHistory();
    const pos = getCanvasCoords(e.clientX, e.clientY);
    pointerPos = pos;
    lastPos = pos;
    paintMaskStroke(pos, pos);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getCanvasCoords(e.clientX, e.clientY);
    pointerPos = pos;
    paintMaskStroke(lastPos || pos, pos);
    lastPos = pos;
  });

  function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;
    lastPos = null;
    pointerPos = null;
    renderComposite(false);
  }

  canvas.addEventListener("pointerup", stopDrawing);
  canvas.addEventListener("pointercancel", stopDrawing);

  // Efek Blur, Bayangan & Teks
  document.getElementById("bgBlurRange")?.addEventListener("input", (e) => {
    blurAmount = Number(e.target.value);
    renderComposite(false);
  });
  document.getElementById("bgShadowRange")?.addEventListener("input", (e) => {
    shadowAmount = Number(e.target.value);
    renderComposite(false);
  });
  document.getElementById("btnBgAddText")?.addEventListener("click", () => {
    stickerText = document.getElementById("bgTextInput").value.trim();
    stickerColor = document.getElementById("bgTextColor").value;
    renderComposite(false);
  });

  // Undo, Redo, Bandingkan, Unduh PNG
  document.getElementById("btnBgUndo")?.addEventListener("click", () => {
    if (undoStack.length <= 1) return;
    redoStack.push(undoStack.pop());
    maskCtx.putImageData(undoStack[undoStack.length - 1], 0, 0);
    renderComposite(false);
  });
  document.getElementById("btnBgRedo")?.addEventListener("click", () => {
    if (!redoStack.length) return;
    const next = redoStack.pop();
    undoStack.push(next);
    maskCtx.putImageData(next, 0, 0);
    renderComposite(false);
  });
  const btnCompare = document.getElementById("btnBgCompare");
  btnCompare?.addEventListener("pointerdown", () => {
    showOriginal = true;
    renderComposite(false);
  });
  btnCompare?.addEventListener("pointerup", () => {
    showOriginal = false;
    renderComposite(false);
  });

  document.getElementById("btnBgDownload")?.addEventListener("click", () => {
    renderComposite(false);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `7d-removebg-${Date.now()}.png`;
    a.click();
  });
}
