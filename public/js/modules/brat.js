import { guardActionAgainstAdblock, saveLocalHistory } from "../app.js?v=8";


export function initBratModule() {
  const textInput = document.getElementById("bratTextInput");
  const canvas = document.getElementById("bratCanvas");
  const ctx = canvas.getContext("2d");
  const themeBtns = document.querySelectorAll(".brat-theme-btn");
  const btnPng = document.getElementById("btnBratPng");
  const btnWebp = document.getElementById("btnBratWebp");

  const themes = {
    white: { bg: "#ffffff", fg: "#1c1c1e" },
    green: { bg: "#8ACE00", fg: "#09090b" },
    black: { bg: "#09090b", fg: "#f4f4f5" },
  };
  let currentTheme = "white";

  // Kanvas resolusi rendah untuk meniru tekstur buram stiker WhatsApp
  const lowCanvas = document.createElement("canvas");
  lowCanvas.width = 210;
  lowCanvas.height = 210;
  const lCtx = lowCanvas.getContext("2d");

  function buildWrappedLines(context, words, maxWidth, hScale) {
    const lines = [];
    let current = [];
    const spaceWidth = context.measureText(" ").width * hScale;

    for (const word of words) {
      const wordWidth = context.measureText(word).width * hScale;
      if (current.length === 0) {
        current.push(word);
      } else {
        const currentWordsWidth = current.reduce(
          (sum, w) => sum + context.measureText(w).width * hScale,
          0
        );
        const totalWithSpace = currentWordsWidth + spaceWidth * current.length + wordWidth;
        if (totalWithSpace <= maxWidth) {
          current.push(word);
        } else {
          lines.push(current);
          current = [word];
        }
      }
    }
    if (current.length > 0) lines.push(current);
    return lines;
  }

  function renderBrat() {
    const { bg, fg } = themes[currentTheme];
    const size = lowCanvas.width;
    const padX = 12;
    const padY = 12;
    const maxW = size - padX * 2;
    const maxH = size - padY * 2;
    const hScale = 0.82; // Proporsi huruf ramping tinggi khas Brat

    const raw = (textInput.value || "ketik teks stiker...")
      .trim()
      .toLowerCase();
    const words = raw.split(/\s+/).filter(Boolean);
    if (!words.length) words.push("7d");

    // Cari ukuran font optimal agar memenuhi kotak secara vertikal & horizontal
    let fontSize = 54;
    let lines = [];

    while (fontSize >= 12) {
      lCtx.font = `400 ${fontSize}px Arial, Helvetica, sans-serif`;
      const widestWord = Math.max(
        ...words.map((w) => lCtx.measureText(w).width * hScale)
      );
      lines = buildWrappedLines(lCtx, words, maxW, hScale);
      const totalHeight = lines.length * (fontSize * 1.12);

      if (widestWord <= maxW && totalHeight <= maxH) {
        break;
      }
      fontSize -= 1;
    }

    // Isi latar
    lCtx.fillStyle = bg;
    lCtx.fillRect(0, 0, size, size);

    lCtx.fillStyle = fg;
    lCtx.font = `400 ${fontSize}px Arial, Helvetica, sans-serif`;
    lCtx.textBaseline = "top";

    const lineHeight = fontSize * 1.12;
    const totalBlockH = lines.length * lineHeight;
    const startY = padY + Math.max(0, (maxH - totalBlockH) / 2);

    lines.forEach((lineWords, lineIdx) => {
      const y = startY + lineIdx * lineHeight;
      const isLastLine = lineIdx === lines.length - 1;

      lCtx.save();
      lCtx.scale(hScale, 1);

      const unscaledMaxW = maxW / hScale;
      const unscaledPadX = padX / hScale;

      if (lineWords.length === 1 || isLastLine) {
        // Baris 1 kata atau baris terakhir: rata kiri dengan spasi normal
        lCtx.fillText(lineWords.join(" "), unscaledPadX, y);
      } else {
        // Baris tengah: rentangkan penuh kiri ke kanan (Full-Justify)
        const wordsTotalW = lineWords.reduce(
          (sum, w) => sum + lCtx.measureText(w).width,
          0
        );
        const gap = (unscaledMaxW - wordsTotalW) / (lineWords.length - 1);
        let cursorX = unscaledPadX;

        lineWords.forEach((word) => {
          lCtx.fillText(word, cursorX, y);
          cursorX += lCtx.measureText(word).width + gap;
        });
      }

      lCtx.restore();
    });

    // Upscale ke kanvas utama 512x512 dengan smoothing untuk efek blur stiker WA
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.filter = "blur(0.45px)";
    ctx.drawImage(lowCanvas, 0, 0, canvas.width, canvas.height);
    ctx.filter = "none";
  }

  function downloadBrat(mimeType, ext) {
    if (!guardActionAgainstAdblock()) return;
    const link = document.createElement("a");
    link.download = `7d-brat-${Date.now()}.${ext}`;
    link.href = canvas.toDataURL(mimeType, 0.92);
    link.click();
    saveLocalHistory("brat", (textInput.value || "brat").slice(0, 28), "#");
  }

  textInput.addEventListener("input", renderBrat);

  themeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      themeBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentTheme = btn.dataset.btheme;
      renderBrat();
    });
  });

  btnPng.addEventListener("click", () => downloadBrat("image/png", "png"));
  btnWebp.addEventListener("click", () => downloadBrat("image/webp", "webp"));

  renderBrat();
}