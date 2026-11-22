import { guardActionAgainstAdblock, saveLocalHistory } from "../app.js?v=4";

export function initRemoveBgModule() {
  const fileInput = document.getElementById("bgFileInput");
  const uploadDrop = document.getElementById("bgUploadDrop");
  const editorWrap = document.getElementById("bgEditorWrap");
  const topTools = document.getElementById("bgTopTools");
  const outCanvas = document.getElementById("bgCanvasOutput");
  const outCtx = outCanvas.getContext("2d");

  // Offscreen canvases untuk layer terpisah
  const origCanvas = document.createElement("canvas");
  const origCtx = origCanvas.getContext("2d");
  const cutoutCanvas = document.createElement("canvas");
  const cutoutCtx = cutoutCanvas.getContext("2d");

  let bgState = { type: "transparent", color: "#18181b", image: null, blur: 0 };
  let shadowBlur = 0;
  let overlayText = { text: "", color: "#ffffff" };
  let brushMode = "erase"; // 'erase' | 'restore'
  let brushSize = 20;
  let isDrawing = false;
  let isComparing = false;

  const undoStack = [];
  const redoStack = [];

  function saveSnapshot() {
    if (undoStack.length >= 12) undoStack.shift();
    undoStack.push(cutoutCtx.getImageData(0, 0, cutoutCanvas.width, cutoutCanvas.height));
    redoStack.length = 0;
  }

  function composeLayers() {
    const w = outCanvas.width;
    const h = outCanvas.height;
    outCtx.clearRect(0, 0, w, h);

    if (isComparing) {
      outCtx.drawImage(origCanvas, 0, 0);
      return;
    }

    // Layer 1: Latar Belakang (Transparan / Warna / Foto + Blur)
    outCtx.save();
    if (bgState.blur > 0) outCtx.filter = `blur(${bgState.blur}px)`;
    if (bgState.type === "color") {
      outCtx.fillStyle = bgState.color;
      outCtx.fillRect(0, 0, w, h);
    } else if (bgState.type === "image" && bgState.image) {
      outCtx.drawImage(bgState.image, 0, 0, w, h);
    }
    outCtx.restore();

    // Layer 2: Subjek Utama + Drop Shadow
    outCtx.save();
    if (shadowBlur > 0) {
      outCtx.shadowColor = "rgba(0, 0, 0, 0.55)";
      outCtx.shadowBlur = shadowBlur;
      outCtx.shadowOffsetY = Math.round(shadowBlur * 0.35);
    }
    outCtx.drawImage(cutoutCanvas, 0, 0);
    outCtx.restore();

    // Layer 3: Teks Stiker
    if (overlayText.text) {
      const size = Math.max(24, Math.round(w * 0.07));
      outCtx.save();
      outCtx.font = `800 ${size}px sans-serif`;
      outCtx.textAlign = "center";
      outCtx.lineWidth = Math.max(3, size * 0.1);
      outCtx.strokeStyle = "#000000";
      outCtx.fillStyle = overlayText.color;
      outCtx.strokeText(overlayText.text, w / 2, h - size * 0.8);
      outCtx.fillText(overlayText.text, w / 2, h - size * 0.8);
      outCtx.restore();
    }
  }

  // Proses AI Background Removal (Lazy-loaded via CDN)
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      return alert("Ukuran gambar maksimal 4 MB.");
    }

    const titleEl = uploadDrop.querySelector(".drop-title");
    titleEl.textContent = "Memproses AI Hapus Latar (Mohon tunggu)...";

    try {
      // Muat gambar asli
      const origUrl = URL.createObjectURL(file);
      const origImg = await loadImage(origUrl);

      // Batasi resolusi maks 1280px agar ringan di RAM HP
      const scale = Math.min(1, 1280 / Math.max(origImg.width, origImg.height));
      const w = Math.round(origImg.width * scale);
      const h = Math.round(origImg.height * scale);

      [outCanvas, origCanvas, cutoutCanvas].forEach((c) => {
        c.width = w;
        c.height = h;
      });
      origCtx.drawImage(origImg, 0, 0, w, h);

      // Import modul AI secara dinamis saat dibutuhkan saja
      const { removeBackground } = await import(
        "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/+esm"
      );
      const resultBlob = await removeBackground(file);
      const cutoutUrl = URL.createObjectURL(resultBlob);
      const cutoutImg = await loadImage(cutoutUrl);

      cutoutCtx.clearRect(0, 0, w, h);
      cutoutCtx.drawImage(cutoutImg, 0, 0, w, h);

      undoStack.length = 0;
      saveSnapshot();

      uploadDrop.classList.add("hidden");
      editorWrap.classList.remove("hidden");
      topTools.classList.remove("hidden");
      composeLayers();
    } catch (err) {
      alert("Gagal memproses gambar: " + err.message);
      titleEl.textContent = "Pilih atau Tarik Foto ke Sini";
    }
  });

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // Kuas Hapus & Pulihkan (Mendukung sentuhan jari & mouse)
  function getCanvasCoords(evt) {
    const rect = outCanvas.getBoundingClientRect();
    const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * outCanvas.width,
      y: ((clientY - rect.top) / rect.height) * outCanvas.height,
    };
  }

  function applyBrushStroke(x, y) {
    const radius = (brushSize / 2) * (outCanvas.width / 350);
    cutoutCtx.save();
    cutoutCtx.beginPath();
    cutoutCtx.arc(x, y, radius, 0, Math.PI * 2);
    if (brushMode === "erase") {
      cutoutCtx.globalCompositeOperation = "destination-out";
      cutoutCtx.fill();
    } else {
      cutoutCtx.clip();
      cutoutCtx.drawImage(origCanvas, 0, 0);
    }
    cutoutCtx.restore();
    composeLayers();
  }

  const startDraw = (e) => {
    isDrawing = true;
    saveSnapshot();
    const { x, y } = getCanvasCoords(e);
    applyBrushStroke(x, y);
  };
  const moveDraw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const { x, y } = getCanvasCoords(e);
    applyBrushStroke(x, y);
  };
  const endDraw = () => { isDrawing = false; };

  outCanvas.addEventListener("mousedown", startDraw);
  outCanvas.addEventListener("mousemove", moveDraw);
  window.addEventListener("mouseup", endDraw);
  outCanvas.addEventListener("touchstart", startDraw, { passive: false });
  outCanvas.addEventListener("touchmove", moveDraw, { passive: false });
  window.addEventListener("touchend", endDraw);

  // Navigasi Sub-panel Dock
  document.querySelectorAll(".dock-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".dock-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".dock-panel").forEach((p) => p.classList.add("hidden"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.panel).classList.remove("hidden");
    });
  });

  // Kontrol Latar Belakang
  document.querySelectorAll(".swatch").forEach((sw) => {
    sw.addEventListener("click", () => {
      const val = sw.dataset.bg;
      bgState = val === "transparent"
        ? { ...bgState, type: "transparent" }
        : { ...bgState, type: "color", color: val };
      composeLayers();
    });
  });

  document.getElementById("bgColorPicker").addEventListener("input", (e) => {
    bgState = { ...bgState, type: "color", color: e.target.value };
    composeLayers();
  });

  document.getElementById("bgCustomPhoto").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const img = await loadImage(URL.createObjectURL(f));
    bgState = { ...bgState, type: "image", image: img };
    composeLayers();
  });

  // Kontrol Kuas, Efek, Teks, Undo/Redo, Bandingkan & Unduh
  const btnErase = document.getElementById("btnBrushErase");
  const btnRestore = document.getElementById("btnBrushRestore");
  btnErase.addEventListener("click", () => {
    brushMode = "erase";
    btnErase.classList.add("active");
    btnRestore.classList.remove("active");
  });
  btnRestore.addEventListener("click", () => {
    brushMode = "restore";
    btnRestore.classList.add("active");
    btnErase.classList.remove("active");
  });

  document.getElementById("brushSizeRange").addEventListener("input", (e) => {
    brushSize = Number(e.target.value);
  });
  document.getElementById("bgBlurRange").addEventListener("input", (e) => {
    bgState.blur = Number(e.target.value);
    composeLayers();
  });
  document.getElementById("bgShadowRange").addEventListener("input", (e) => {
    shadowBlur = Number(e.target.value);
    composeLayers();
  });
  document.getElementById("btnBgAddText").addEventListener("click", () => {
    overlayText = {
      text: document.getElementById("bgTextInput").value.trim(),
      color: document.getElementById("bgTextColor").value,
    };
    composeLayers();
  });

  document.getElementById("btnBgUndo").addEventListener("click", () => {
    if (undoStack.length <= 1) return;
    redoStack.push(undoStack.pop());
    cutoutCtx.putImageData(undoStack[undoStack.length - 1], 0, 0);
    composeLayers();
  });

  document.getElementById("btnBgRedo").addEventListener("click", () => {
    if (!redoStack.length) return;
    const next = redoStack.pop();
    undoStack.push(next);
    cutoutCtx.putImageData(next, 0, 0);
    composeLayers();
  });

  const btnCompare = document.getElementById("btnBgCompare");
  btnCompare.addEventListener("pointerdown", () => { isComparing = true; composeLayers(); });
  btnCompare.addEventListener("pointerup", () => { isComparing = false; composeLayers(); });
  btnCompare.addEventListener("pointerleave", () => { isComparing = false; composeLayers(); });

  document.getElementById("btnBgDownload").addEventListener("click", () => {
    if (!guardActionAgainstAdblock()) return;
    const link = document.createElement("a");
    link.download = `7d-removebg-${Date.now()}.png`;
    link.href = outCanvas.toDataURL("image/png");
    link.click();
    saveLocalHistory("removebg", "Edit Studio PNG", "#");
  });
}
