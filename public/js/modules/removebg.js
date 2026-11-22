import { guardActionAgainstAdblock, saveLocalHistory } from "../app.js?v=4";

let bgRemoverFn = null;

async function getGeneralBgRemover() {
  if (bgRemoverFn) return bgRemoverFn;
  const mod = await import("https://esm.sh/@imgly/background-removal@1.5.5");
  bgRemoverFn = mod.removeBackground;
  return bgRemoverFn;
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
  let brushSize = 18;
  let isDrawing = false;
  let showOriginal = false;

  // State Zoom & Pan
  let zoomLevel = 1;
  let panX = 0;
  let panY = 0;
  const activePointers = new Map();
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let panStartMid = null;
  let panStartOffset = { x: 0, y: 0 };
  let strokeSnapshotBeforeTap = null;

  // Koordinat & status indikator lingkaran kuas
  let pointerPos = null;
  let lastPos = null;
  let sizePreviewTimer = null;

  const undoStack = [];
  const redoStack = [];

  // Siapkan viewport kanvas agar zoom tidak meluber keluar kotak
  const viewport = canvas.parentElement;
  if (viewport) {
    viewport.style.overflow = "hidden";
    viewport.style.touchAction = "none";
    viewport.style.position = "relative";
  }
  canvas.style.touchAction = "none";
  canvas.style.transformOrigin = "0 0";

  // Tambahkan tombol kontrol Zoom (- | 1.0x | +) di bar atas
  let zoomLabelEl = null;
  if (topTools && !document.getElementById("bgZoomControls")) {
    const zoomGroup = document.createElement("div");
    zoomGroup.id = "bgZoomControls";
    zoomGroup.style.cssText =
      "display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.06);padding:3px 6px;border-radius:10px;";

    const btnZoomOut = document.createElement("button");
    btnZoomOut.type = "button";
    btnZoomOut.className = "btn-ghost-sm";
    btnZoomOut.textContent = "−";
    btnZoomOut.style.padding = "4px 9px";

    zoomLabelEl = document.createElement("button");
    zoomLabelEl.type = "button";
    zoomLabelEl.className = "btn-ghost-sm";
    zoomLabelEl.textContent = "1.0x";
    zoomLabelEl.style.cssText = "padding:4px 8px;font-size:0.78rem;min-width:46px;";

    const btnZoomIn = document.createElement("button");
    btnZoomIn.type = "button";
    btnZoomIn.className = "btn-ghost-sm";
    btnZoomIn.textContent = "+";
    btnZoomIn.style.padding = "4px 9px";

    btnZoomOut.addEventListener("click", () => setZoom(zoomLevel - 0.5));
    btnZoomIn.addEventListener("click", () => setZoom(zoomLevel + 0.5));
    zoomLabelEl.addEventListener("click", resetZoomAndPan);

    zoomGroup.append(btnZoomOut, zoomLabelEl, btnZoomIn);
    topTools.appendChild(zoomGroup);
  }

  function clampPan() {
    if (!viewport) return;
    const vw = viewport.clientWidth || canvas.offsetWidth;
    const vh = viewport.clientHeight || canvas.offsetHeight;
    const scaledW = canvas.offsetWidth * zoomLevel;
    const scaledH = canvas.offsetHeight * zoomLevel;

    if (zoomLevel <= 1) {
      panX = 0;
      panY = 0;
      return;
    }
    const minX = Math.min(0, vw - scaledW);
    const minY = Math.min(0, vh - scaledH);
    panX = Math.max(minX, Math.min(0, panX));
    panY = Math.max(minY, Math.min(0, panY));
  }

  function applyTransform() {
    clampPan();
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
    if (zoomLabelEl) {
      zoomLabelEl.textContent = `${zoomLevel.toFixed(1)}x`;
    }
  }

  function setZoom(nextZoom, centerClientX = null, centerClientY = null) {
    const prevZoom = zoomLevel;
    zoomLevel = Math.max(1, Math.min(5, Number(nextZoom.toFixed(2))));

    if (zoomLevel === 1) {
      panX = 0;
      panY = 0;
    } else if (viewport && centerClientX !== null && centerClientY !== null) {
      const vRect = viewport.getBoundingClientRect();
      const cx = centerClientX - vRect.left;
      const cy = centerClientY - vRect.top;
      const ratio = zoomLevel / prevZoom;
      panX = cx - (cx - panX) * ratio;
      panY = cy - (cy - panY) * ratio;
    } else if (viewport) {
      const cx = (viewport.clientWidth || 0) / 2;
      const cy = (viewport.clientHeight || 0) / 2;
      const ratio = zoomLevel / prevZoom;
      panX = cx - (cx - panX) * ratio;
      panY = cy - (cy - panY) * ratio;
    }
    applyTransform();
  }

  function resetZoomAndPan() {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    applyTransform();
  }

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

    // 2. Potong Objek Sesuai Alpha Masker (Halus / Anti-aliased)
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
      const effectiveRadius = brushSize / zoomLevel;
      ctx.save();
      ctx.beginPath();
      ctx.arc(pointerPos.x, pointerPos.y, effectiveRadius, 0, Math.PI * 2);
      ctx.fillStyle =
        brushMode === "erase"
          ? "rgba(239, 68, 68, 0.38)"
          : "rgba(16, 185, 129, 0.35)";
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, Math.round(w * 0.0035) / zoomLevel);
      ctx.strokeStyle = brushMode === "erase" ? "#ef4444" : "#10b981";
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(pointerPos.x, pointerPos.y, 2 / zoomLevel, 0, Math.PI * 2);
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
    titleEl.textContent = "Memproses AI Presisi Tinggi...";

    try {
      const img = await createImageBitmap(file);
      const maxDim = 1280;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      canvas.width = originalCanvas.width = maskCanvas.width = cutoutCanvas.width = w;
      canvas.height = originalCanvas.height = maskCanvas.height = cutoutCanvas.height = h;

      originalCanvas.getContext("2d").drawImage(img, 0, 0, w, h);

      // Jalankan model IS-Net general purpose (halus untuk logo, mobil, produk, & orang)
      const removeBackground = await getGeneralBgRemover();
      const resultBlob = await removeBackground(file, {
        model: "isnet_quint8",
        output: { format: "image/png", quality: 1 },
        progress: (_key, current, total) => {
          if (total > 0) {
            const pct = Math.min(99, Math.round((current / total) * 100));
            titleEl.textContent = `Memproses AI Presisi (${pct}%)...`;
          }
        },
      });

      const cutoutBitmap = await createImageBitmap(resultBlob);
      maskCtx.clearRect(0, 0, w, h);
      maskCtx.drawImage(cutoutBitmap, 0, 0, w, h);

      undoStack.length = 0;
      redoStack.length = 0;
      pushMaskHistory();
      resetZoomAndPan();

      dropZone.classList.add("hidden");
      editorWrap.classList.remove("hidden");
      topTools.classList.remove("hidden");
      renderComposite(false);
      saveLocalHistory("removebg", file.name, "Studio Cutout HD");
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

  // Pratinjau lingkaran merah saat slider ukuran kuas digeser
  document.getElementById("brushSizeRange")?.addEventListener("input", (e) => {
    brushSize = Number(e.target.value);
    if (canvas.width > 0) {
      const rect = canvas.getBoundingClientRect();
      const vRect = (viewport || canvas).getBoundingClientRect();
      const midX = vRect.left + vRect.width / 2;
      const midY = vRect.top + vRect.height / 2;
      pointerPos = {
        x: ((midX - rect.left) / rect.width) * canvas.width,
        y: ((midY - rect.top) / rect.height) * canvas.height,
      };
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
    const effectiveRadius = brushSize / zoomLevel;
    maskCtx.save();
    maskCtx.globalCompositeOperation = brushMode === "erase" ? "destination-out" : "source-over";
    maskCtx.strokeStyle = "rgba(255,255,255,1)";
    maskCtx.fillStyle = "rgba(255,255,255,1)";
    maskCtx.lineWidth = effectiveRadius * 2;
    maskCtx.lineCap = "round";
    maskCtx.lineJoin = "round";

    maskCtx.beginPath();
    maskCtx.moveTo(fromPos.x, fromPos.y);
    maskCtx.lineTo(toPos.x, toPos.y);
    maskCtx.stroke();

    maskCtx.beginPath();
    maskCtx.arc(toPos.x, toPos.y, effectiveRadius, 0, Math.PI * 2);
    maskCtx.fill();
    maskCtx.restore();

    renderComposite(true);
  }

  function getPinchMetrics() {
    const pts = Array.from(activePointers.values());
    const dx = pts[1].x - pts[0].x;
    const dy = pts[1].y - pts[0].y;
    return {
      dist: Math.hypot(dx, dy),
      midX: (pts[0].x + pts[1].x) / 2,
      midY: (pts[0].y + pts[1].y) / 2,
    };
  }

  // Gesture 1 jari = Kuas Merah | 2 jari = Cubit Zoom & Geser
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 1) {
      isDrawing = true;
      strokeSnapshotBeforeTap = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      pushMaskHistory();
      const pos = getCanvasCoords(e.clientX, e.clientY);
      pointerPos = pos;
      lastPos = pos;
      paintMaskStroke(pos, pos);
    } else if (activePointers.size === 2) {
      // Batalkan titik kuas jika jari kedua menyentuh layar untuk pinch-zoom
      if (isDrawing && strokeSnapshotBeforeTap) {
        maskCtx.putImageData(strokeSnapshotBeforeTap, 0, 0);
        undoStack.pop();
        strokeSnapshotBeforeTap = null;
      }
      isDrawing = false;
      pointerPos = null;
      lastPos = null;
      renderComposite(false);

      const { dist, midX, midY } = getPinchMetrics();
      pinchStartDist = dist || 1;
      pinchStartZoom = zoomLevel;
      panStartMid = { x: midX, y: midY };
      panStartOffset = { x: panX, y: panY };
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!activePointers.has(e.pointerId)) return;
    e.preventDefault();
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2 && panStartMid) {
      const { dist, midX, midY } = getPinchMetrics();
      const scaleFactor = dist / pinchStartDist;
      const targetZoom = Math.max(1, Math.min(5, pinchStartZoom * scaleFactor));

      if (viewport) {
        const vRect = viewport.getBoundingClientRect();
        const anchorX = panStartMid.x - vRect.left;
        const anchorY = panStartMid.y - vRect.top;
        const ratio = targetZoom / pinchStartZoom;

        zoomLevel = Number(targetZoom.toFixed(2));
        panX = anchorX - (anchorX - panStartOffset.x) * ratio + (midX - panStartMid.x);
        panY = anchorY - (anchorY - panStartOffset.y) * ratio + (midY - panStartMid.y);
        applyTransform();
      }
      return;
    }

    if (activePointers.size === 1 && isDrawing) {
      const pos = getCanvasCoords(e.clientX, e.clientY);
      pointerPos = pos;
      paintMaskStroke(lastPos || pos, pos);
      lastPos = pos;
    }
  });

  function handlePointerEnd(e) {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) {
      panStartMid = null;
    }
    if (activePointers.size === 0) {
      isDrawing = false;
      lastPos = null;
      pointerPos = null;
      strokeSnapshotBeforeTap = null;
      renderComposite(false);
    }
  }

  canvas.addEventListener("pointerup", handlePointerEnd);
  canvas.addEventListener("pointercancel", handlePointerEnd);

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
