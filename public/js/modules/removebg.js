import { guardActionAgainstAdblock, saveLocalHistory } from "../app.js?v=4";

let modnetPromise = null;

async function getModnetPipeline(onProgress) {
  if (!modnetPromise) {
    modnetPromise = (async () => {
      const { AutoModel, AutoProcessor, RawImage, env } = await import(
        "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.1.2"
      );
      env.allowLocalModels = false;

      const model = await AutoModel.from_pretrained("Xenova/modnet", {
        dtype: "q8",
        progress_callback: (info) => {
          if (info?.status === "progress" && typeof info.progress === "number" && onProgress) {
            onProgress(Math.min(95, Math.round(info.progress)));
          }
        },
      });
      const processor = await AutoProcessor.from_pretrained("Xenova/modnet");
      return { model, processor, RawImage };
    })().catch((err) => {
      modnetPromise = null;
      throw err;
    });
  }
  return modnetPromise;
}

export function initRemoveBgModule() {
  const fileInput = document.getElementById("bgFileInput");
  const dropZone = document.getElementById("bgUploadDrop");
  const editorWrap = document.getElementById("bgEditorWrap");
  const topTools = document.getElementById("bgTopTools");
  const canvas = document.getElementById("bgCanvasOutput");
  if (!canvas || !fileInput) return;

  fileInput.multiple = true;
  const ctx = canvas.getContext("2d");

  const cutoutCanvas = document.createElement("canvas");
  const cutoutCtx = cutoutCanvas.getContext("2d");

  const sessions = [];
  let activeSessionId = null;

  let brushMode = "erase";
  let brushSize = 18;
  let isDrawing = false;
  let showOriginal = false;

  // State Gesture Zoom & Pan
  const activePointers = new Map();
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let panStartMid = null;
  let panStartOffset = { x: 0, y: 0 };
  let strokeSnapshotBeforeTap = null;

  // Koordinat indikator lingkaran kuas
  let pointerPos = null;
  let lastPos = null;
  let sizePreviewTimer = null;

  function getActiveSession() {
    return sessions.find((s) => s.id === activeSessionId) || null;
  }

  const viewport = canvas.parentElement;
  if (viewport) {
    viewport.style.overflow = "hidden";
    viewport.style.touchAction = "none";
    viewport.style.position = "relative";
  }
  canvas.style.touchAction = "none";
  canvas.style.transformOrigin = "0 0";

  // Strip thumbnail + tombol (+) di atas editorWrap
  let stripContainer = document.getElementById("bgMultiStrip");
  if (!stripContainer && editorWrap) {
    stripContainer = document.createElement("div");
    stripContainer.id = "bgMultiStrip";
    stripContainer.style.cssText =
      "display:flex;align-items:center;gap:10px;overflow-x:auto;padding:4px 2px 12px 2px;margin-bottom:6px;scrollbar-width:none;";
    editorWrap.insertBefore(stripContainer, editorWrap.firstChild);
  }

  // Tombol kontrol Zoom (- | 1.0x | +)
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

    btnZoomOut.addEventListener("click", () => {
      const s = getActiveSession();
      if (s) setZoom(s.zoomLevel - 0.5);
    });
    btnZoomIn.addEventListener("click", () => {
      const s = getActiveSession();
      if (s) setZoom(s.zoomLevel + 0.5);
    });
    zoomLabelEl.addEventListener("click", resetZoomAndPan);

    zoomGroup.append(btnZoomOut, zoomLabelEl, btnZoomIn);
    topTools.appendChild(zoomGroup);
  }

  function generateSessionThumb(session) {
    const tCanvas = document.createElement("canvas");
    tCanvas.width = 96;
    tCanvas.height = 96;
    const tCtx = tCanvas.getContext("2d");

    const scale = Math.min(96 / session.width, 96 / session.height);
    const dw = Math.round(session.width * scale);
    const dh = Math.round(session.height * scale);
    const dx = Math.round((96 - dw) / 2);
    const dy = Math.round((96 - dh) / 2);

    const tmpCut = document.createElement("canvas");
    tmpCut.width = session.width;
    tmpCut.height = session.height;
    const tmpCtx = tmpCut.getContext("2d");
    tmpCtx.drawImage(session.originalCanvas, 0, 0);
    tmpCtx.globalCompositeOperation = "destination-in";
    tmpCtx.drawImage(session.maskCanvas, 0, 0);

    tCtx.drawImage(tmpCut, dx, dy, dw, dh);
    session.thumbUrl = tCanvas.toDataURL("image/png");
  }

  function renderThumbnailStrip() {
    if (!stripContainer) return;
    stripContainer.innerHTML = "";

    const btnAdd = document.createElement("button");
    btnAdd.type = "button";
    btnAdd.title = "Tambah Foto Baru";
    btnAdd.style.cssText =
      "width:52px;height:52px;border-radius:14px;border:1.5px dashed rgba(255,255,255,0.28);background:rgba(255,255,255,0.05);color:inherit;font-size:1.45rem;font-weight:600;display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;";
    btnAdd.textContent = "+";
    btnAdd.addEventListener("click", () => {
      fileInput.value = "";
      fileInput.click();
    });
    stripContainer.appendChild(btnAdd);

    sessions.forEach((sess) => {
      const isActive = sess.id === activeSessionId;
      const itemWrap = document.createElement("div");
      itemWrap.style.cssText = `position:relative;width:52px;height:52px;border-radius:14px;flex-shrink:0;cursor:pointer;overflow:hidden;border:2.5px solid ${
        isActive ? "#10b981" : "rgba(255,255,255,0.14)"
      };background-image:linear-gradient(45deg,#2a2a2e 25%,transparent 25%),linear-gradient(-45deg,#2a2a2e 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a2e 75%),linear-gradient(-45deg,transparent 75%,#2a2a2e 75%);background-size:12px 12px;background-position:0 0,0 6px,6px -6px,-6px 0;background-color:#1c1c20;`;

      const img = document.createElement("img");
      img.src = sess.thumbUrl;
      img.alt = sess.name;
      img.style.cssText = "width:100%;height:100%;object-fit:contain;display:block;";
      itemWrap.appendChild(img);

      itemWrap.addEventListener("click", () => {
        if (activeSessionId !== sess.id) {
          switchToSession(sess.id);
        }
      });

      if (isActive) {
        const btnDel = document.createElement("button");
        btnDel.type = "button";
        btnDel.title = "Hapus foto ini";
        btnDel.textContent = "×";
        btnDel.style.cssText =
          "position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;border:none;background:rgba(239,68,68,0.92);color:#fff;font-size:12px;font-weight:800;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;";
        btnDel.addEventListener("click", (e) => {
          e.stopPropagation();
          removeSession(sess.id);
        });
        itemWrap.appendChild(btnDel);
      }

      stripContainer.appendChild(itemWrap);
    });
  }

  function switchToSession(id) {
    const sess = sessions.find((s) => s.id === id);
    if (!sess) return;
    activeSessionId = id;

    canvas.width = cutoutCanvas.width = sess.width;
    canvas.height = cutoutCanvas.height = sess.height;

    const blurInput = document.getElementById("bgBlurRange");
    const shadowInput = document.getElementById("bgShadowRange");
    const textInput = document.getElementById("bgTextInput");
    if (blurInput) blurInput.value = String(sess.blurAmount);
    if (shadowInput) shadowInput.value = String(sess.shadowAmount);
    if (textInput) textInput.value = sess.stickerText;

    applyTransform();
    renderThumbnailStrip();
    renderComposite(false);
  }

  function removeSession(id) {
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx === -1) return;
    sessions.splice(idx, 1);

    if (sessions.length === 0) {
      activeSessionId = null;
      editorWrap.classList.add("hidden");
      topTools.classList.add("hidden");
      dropZone.classList.remove("hidden");
      return;
    }

    const nextIdx = Math.min(idx, sessions.length - 1);
    switchToSession(sessions[nextIdx].id);
  }

  function clampPan(sess) {
    if (!viewport || !sess) return;
    const vw = viewport.clientWidth || canvas.offsetWidth;
    const vh = viewport.clientHeight || canvas.offsetHeight;
    const scaledW = canvas.offsetWidth * sess.zoomLevel;
    const scaledH = canvas.offsetHeight * sess.zoomLevel;

    if (sess.zoomLevel <= 1) {
      sess.panX = 0;
      sess.panY = 0;
      return;
    }
    const minX = Math.min(0, vw - scaledW);
    const minY = Math.min(0, vh - scaledH);
    sess.panX = Math.max(minX, Math.min(0, sess.panX));
    sess.panY = Math.max(minY, Math.min(0, sess.panY));
  }

  function applyTransform() {
    const sess = getActiveSession();
    if (!sess) return;
    clampPan(sess);
    canvas.style.transform = `translate(${sess.panX}px, ${sess.panY}px) scale(${sess.zoomLevel})`;
    if (zoomLabelEl) {
      zoomLabelEl.textContent = `${sess.zoomLevel.toFixed(1)}x`;
    }
  }

  function setZoom(nextZoom, centerClientX = null, centerClientY = null) {
    const sess = getActiveSession();
    if (!sess) return;
    const prevZoom = sess.zoomLevel;
    sess.zoomLevel = Math.max(1, Math.min(5, Number(nextZoom.toFixed(2))));

    if (sess.zoomLevel === 1) {
      sess.panX = 0;
      sess.panY = 0;
    } else if (viewport && centerClientX !== null && centerClientY !== null) {
      const vRect = viewport.getBoundingClientRect();
      const cx = centerClientX - vRect.left;
      const cy = centerClientY - vRect.top;
      const ratio = sess.zoomLevel / prevZoom;
      sess.panX = cx - (cx - sess.panX) * ratio;
      sess.panY = cy - (cy - sess.panY) * ratio;
    } else if (viewport) {
      const cx = (viewport.clientWidth || 0) / 2;
      const cy = (viewport.clientHeight || 0) / 2;
      const ratio = sess.zoomLevel / prevZoom;
      sess.panX = cx - (cx - sess.panX) * ratio;
      sess.panY = cy - (cy - sess.panY) * ratio;
    }
    applyTransform();
  }

  function resetZoomAndPan() {
    const sess = getActiveSession();
    if (!sess) return;
    sess.zoomLevel = 1;
    sess.panX = 0;
    sess.panY = 0;
    applyTransform();
  }

  function pushMaskHistory(sess) {
    if (!sess) return;
    sess.undoStack.push(sess.maskCtx.getImageData(0, 0, sess.width, sess.height));
    if (sess.undoStack.length > 15) sess.undoStack.shift();
    sess.redoStack.length = 0;
  }

  function renderComposite(includeCursor = true) {
    const sess = getActiveSession();
    if (!sess) return;

    const w = sess.width;
    const h = sess.height;
    ctx.clearRect(0, 0, w, h);

    if (showOriginal) {
      ctx.drawImage(sess.originalCanvas, 0, 0);
      return;
    }

    if (sess.bgMode === "photo" && sess.bgPhotoImg) {
      ctx.save();
      if (sess.blurAmount > 0) ctx.filter = `blur(${sess.blurAmount}px)`;
      ctx.drawImage(sess.bgPhotoImg, 0, 0, w, h);
      ctx.restore();
    } else if (sess.bgMode !== "transparent") {
      ctx.fillStyle = sess.bgMode;
      ctx.fillRect(0, 0, w, h);
    }

    cutoutCtx.clearRect(0, 0, w, h);
    cutoutCtx.globalCompositeOperation = "source-over";
    cutoutCtx.drawImage(sess.originalCanvas, 0, 0);
    cutoutCtx.globalCompositeOperation = "destination-in";
    cutoutCtx.drawImage(sess.maskCanvas, 0, 0);

    ctx.save();
    if (sess.shadowAmount > 0) {
      ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
      ctx.shadowBlur = sess.shadowAmount;
      ctx.shadowOffsetY = Math.round(sess.shadowAmount * 0.3);
    }
    ctx.drawImage(cutoutCanvas, 0, 0);
    ctx.restore();

    if (sess.stickerText) {
      ctx.save();
      const fontSize = Math.max(24, Math.round(w * 0.065));
      ctx.font = `800 ${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = sess.stickerColor;
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = Math.max(3, Math.round(fontSize * 0.12));
      ctx.strokeText(sess.stickerText, w / 2, h - fontSize * 0.8);
      ctx.fillText(sess.stickerText, w / 2, h - fontSize * 0.8);
      ctx.restore();
    }

    if (includeCursor && pointerPos) {
      const effectiveRadius = brushSize / sess.zoomLevel;
      ctx.save();
      ctx.beginPath();
      ctx.arc(pointerPos.x, pointerPos.y, effectiveRadius, 0, Math.PI * 2);
      ctx.fillStyle =
        brushMode === "erase"
          ? "rgba(239, 68, 68, 0.38)"
          : "rgba(16, 185, 129, 0.35)";
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, Math.round(w * 0.0035) / sess.zoomLevel);
      ctx.strokeStyle = brushMode === "erase" ? "#ef4444" : "#10b981";
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(pointerPos.x, pointerPos.y, 2 / sess.zoomLevel, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.restore();
    }
  }

  async function processSingleFile(file, statusCallback) {
    if (file.size > 4 * 1024 * 1024) {
      alert(`Foto "${file.name}" melebihi 4 MB dan dilewati.`);
      return null;
    }

    const img = await createImageBitmap(file);
    const maxDim = 1280;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    const origC = document.createElement("canvas");
    origC.width = w;
    origC.height = h;
    origC.getContext("2d").drawImage(img, 0, 0, w, h);

    const mCanvas = document.createElement("canvas");
    mCanvas.width = w;
    mCanvas.height = h;
    const mCtx = mCanvas.getContext("2d");

    const { model, processor, RawImage } = await getModnetPipeline(statusCallback);
    if (statusCallback) statusCallback(98);

    const rawImg = RawImage.fromCanvas(origC);
    const { pixel_values } = await processor(rawImg);
    const { output } = await model({ input: pixel_values });

    const alphaTensor = output[0].mul(255).to("uint8");
    const resizedMask = await RawImage.fromTensor(alphaTensor).resize(w, h);
    const maskData = resizedMask.data;
    const step = resizedMask.channels || 1;

    const imgData = mCtx.createImageData(w, h);
    const totalPixels = w * h;
    for (let i = 0; i < totalPixels; i++) {
      const alpha = maskData[i * step];
      const idx = i * 4;
      imgData.data[idx] = 255;
      imgData.data[idx + 1] = 255;
      imgData.data[idx + 2] = 255;
      imgData.data[idx + 3] = alpha;
    }
    mCtx.putImageData(imgData, 0, 0);

    const session = {
      id: `bg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      width: w,
      height: h,
      originalCanvas: origC,
      maskCanvas: mCanvas,
      maskCtx: mCtx,
      undoStack: [],
      redoStack: [],
      bgMode: "transparent",
      bgPhotoImg: null,
      blurAmount: 0,
      shadowAmount: 0,
      stickerText: "",
      stickerColor: "#ffffff",
      zoomLevel: 1,
      panX: 0,
      panY: 0,
      thumbUrl: "",
    };

    pushMaskHistory(session);
    generateSessionThumb(session);
    sessions.push(session);
    saveLocalHistory("removebg", file.name, "Studio Cutout HD");
    return session;
  }

  async function handleFilesUpload(fileList) {
    if (!guardActionAgainstAdblock()) return;
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const titleEl = dropZone.querySelector(".drop-title");
    const oldTitle = titleEl.textContent;

    const addBtn = stripContainer?.querySelector("button");
    if (addBtn) {
      addBtn.disabled = true;
      addBtn.textContent = "…";
    }

    try {
      let lastCreated = null;
      for (let i = 0; i < files.length; i++) {
        const labelPrefix = files.length > 1 ? `Foto ${i + 1}/${files.length}` : "AI Presisi";
        titleEl.textContent = `Memproses ${labelPrefix}...`;

        const created = await processSingleFile(files[i], (pct) => {
          titleEl.textContent = `Memproses ${labelPrefix} (${pct}%)...`;
        });
        if (created) lastCreated = created;
      }

      if (lastCreated) {
        dropZone.classList.add("hidden");
        editorWrap.classList.remove("hidden");
        topTools.classList.remove("hidden");
        switchToSession(lastCreated.id);
      }
    } catch (err) {
      alert("Gagal memproses gambar: " + err.message);
    } finally {
      titleEl.textContent = oldTitle;
      if (addBtn) {
        addBtn.disabled = false;
        addBtn.textContent = "+";
      }
    }
  }

  fileInput.addEventListener("change", (e) => {
    if (e.target.files?.length) {
      handleFilesUpload(e.target.files);
    }
  });

  document.querySelectorAll(".dock-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".dock-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".dock-panel").forEach((p) => p.classList.add("hidden"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.panel)?.classList.remove("hidden");
    });
  });

  document.querySelectorAll(".swatch").forEach((sw) => {
    sw.addEventListener("click", () => {
      const sess = getActiveSession();
      if (!sess) return;
      sess.bgMode = sw.dataset.bg;
      renderComposite(false);
    });
  });

  document.getElementById("bgColorPicker")?.addEventListener("input", (e) => {
    const sess = getActiveSession();
    if (!sess) return;
    sess.bgMode = e.target.value;
    renderComposite(false);
  });

  document.getElementById("bgCustomPhoto")?.addEventListener("change", async (e) => {
    const sess = getActiveSession();
    const f = e.target.files?.[0];
    if (!sess || !f) return;
    sess.bgPhotoImg = await createImageBitmap(f);
    sess.bgMode = "photo";
    renderComposite(false);
  });

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
    const sess = getActiveSession();
    if (!sess) return;
    const effectiveRadius = brushSize / sess.zoomLevel;
    const mCtx = sess.maskCtx;

    mCtx.save();
    mCtx.globalCompositeOperation = brushMode === "erase" ? "destination-out" : "source-over";
    mCtx.strokeStyle = "rgba(255,255,255,1)";
    mCtx.fillStyle = "rgba(255,255,255,1)";
    mCtx.lineWidth = effectiveRadius * 2;
    mCtx.lineCap = "round";
    mCtx.lineJoin = "round";

    mCtx.beginPath();
    mCtx.moveTo(fromPos.x, fromPos.y);
    mCtx.lineTo(toPos.x, toPos.y);
    mCtx.stroke();

    mCtx.beginPath();
    mCtx.arc(toPos.x, toPos.y, effectiveRadius, 0, Math.PI * 2);
    mCtx.fill();
    mCtx.restore();

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

  canvas.addEventListener("pointerdown", (e) => {
    const sess = getActiveSession();
    if (!sess) return;
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 1) {
      isDrawing = true;
      strokeSnapshotBeforeTap = sess.maskCtx.getImageData(0, 0, sess.width, sess.height);
      pushMaskHistory(sess);
      const pos = getCanvasCoords(e.clientX, e.clientY);
      pointerPos = pos;
      lastPos = pos;
      paintMaskStroke(pos, pos);
    } else if (activePointers.size === 2) {
      if (isDrawing && strokeSnapshotBeforeTap) {
        sess.maskCtx.putImageData(strokeSnapshotBeforeTap, 0, 0);
        sess.undoStack.pop();
        strokeSnapshotBeforeTap = null;
      }
      isDrawing = false;
      pointerPos = null;
      lastPos = null;
      renderComposite(false);

      const { dist, midX, midY } = getPinchMetrics();
      pinchStartDist = dist || 1;
      pinchStartZoom = sess.zoomLevel;
      panStartMid = { x: midX, y: midY };
      panStartOffset = { x: sess.panX, y: sess.panY };
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const sess = getActiveSession();
    if (!sess || !activePointers.has(e.pointerId)) return;
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

        sess.zoomLevel = Number(targetZoom.toFixed(2));
        sess.panX = anchorX - (anchorX - panStartOffset.x) * ratio + (midX - panStartMid.x);
        sess.panY = anchorY - (anchorY - panStartOffset.y) * ratio + (midY - panStartMid.y);
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
      if (isDrawing) {
        const sess = getActiveSession();
        if (sess) {
          generateSessionThumb(sess);
          renderThumbnailStrip();
        }
      }
      isDrawing = false;
      lastPos = null;
      pointerPos = null;
      strokeSnapshotBeforeTap = null;
      renderComposite(false);
    }
  }

  canvas.addEventListener("pointerup", handlePointerEnd);
  canvas.addEventListener("pointercancel", handlePointerEnd);

  document.getElementById("bgBlurRange")?.addEventListener("input", (e) => {
    const sess = getActiveSession();
    if (!sess) return;
    sess.blurAmount = Number(e.target.value);
    renderComposite(false);
  });
  document.getElementById("bgShadowRange")?.addEventListener("input", (e) => {
    const sess = getActiveSession();
    if (!sess) return;
    sess.shadowAmount = Number(e.target.value);
    renderComposite(false);
  });
  document.getElementById("btnBgAddText")?.addEventListener("click", () => {
    const sess = getActiveSession();
    if (!sess) return;
    sess.stickerText = document.getElementById("bgTextInput").value.trim();
    sess.stickerColor = document.getElementById("bgTextColor").value;
    renderComposite(false);
  });

  document.getElementById("btnBgUndo")?.addEventListener("click", () => {
    const sess = getActiveSession();
    if (!sess || sess.undoStack.length <= 1) return;
    sess.redoStack.push(sess.undoStack.pop());
    sess.maskCtx.putImageData(sess.undoStack[sess.undoStack.length - 1], 0, 0);
    generateSessionThumb(sess);
    renderThumbnailStrip();
    renderComposite(false);
  });
  document.getElementById("btnBgRedo")?.addEventListener("click", () => {
    const sess = getActiveSession();
    if (!sess || !sess.redoStack.length) return;
    const next = sess.redoStack.pop();
    sess.undoStack.push(next);
    sess.maskCtx.putImageData(next, 0, 0);
    generateSessionThumb(sess);
    renderThumbnailStrip();
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
    const sess = getActiveSession();
    if (!sess) return;
    renderComposite(false);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `7d-removebg-${Date.now()}.png`;
    a.click();
  });
}
