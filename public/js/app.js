import { initUpscalerModule } from "./modules/upscaler.js?v=10";
import {
  initAdSystem,
  guardActionAgainstAdblock,
  refreshAdSlotsOnTabSwitch,
} from "./adblock.js?v=4";
import { initDownloaderModule } from "./modules/downloader.js?v=4";
import { initRemoveBgModule } from "./modules/removebg.js?v=10";
import { initQrModule } from "./modules/qrstudio.js?v=4";
import { initBratModule } from "./modules/brat.js?v=4";

// 1. Pengalih Tema Dark / Light Mode (Dijalankan Pertama)
const btnTheme = document.getElementById("btnThemeToggle");
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("7d_theme", theme);
  if (btnTheme) {
    btnTheme.textContent = theme === "dark" ? "☀️" : "🌙";
  }
}

applyTheme(localStorage.getItem("7d_theme") || "dark");

if (btnTheme) {
  btnTheme.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(current === "dark" ? "light" : "dark");
  });
}

// 2. Navigasi SPA Per-Tab Tunggal
const tabButtons = document.querySelectorAll(".tab-pill");
const workspaces = document.querySelectorAll(".workspace-card");

function switchTab(targetName) {
  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.tab === targetName;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });

  workspaces.forEach((section) => {
    section.classList.toggle("hidden", section.id !== `tab-${targetName}`);
  });

  refreshAdSlotsOnTabSwitch();
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// 3. Panel Riwayat Lokal
const historyModal = document.getElementById("historyModal");
const historyList = document.getElementById("historyList");

export function saveLocalHistory(tool, title, url) { return;
  const items = JSON.parse(localStorage.getItem("7d_history") || "[]");
  items.unshift({ tool, title, url, time: new Date().toLocaleTimeString("id-ID") });
  localStorage.setItem("7d_history", JSON.stringify(items.slice(0, 20)));
}

function renderLocalHistory() {
  const items = JSON.parse(localStorage.getItem("7d_history") || "[]");
  historyList.innerHTML = "";
  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "history-item";
    empty.textContent = "Belum ada riwayat aktivitas.";
    historyList.appendChild(empty);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "history-item";
    li.textContent = `[${item.tool.toUpperCase()}] ${item.title} (${item.time})`;
    historyList.appendChild(li);
  });
}

document.getElementById("btnHistoryToggle")?.addEventListener("click", () => {
  renderLocalHistory();
  historyModal.classList.remove("hidden");
});
document.getElementById("btnHistoryClose")?.addEventListener("click", () => {
  historyModal.classList.add("hidden");
});

// 4. Inisialisasi Sistem Iklan & 4 Modul Utama
initAdSystem();
initDownloaderModule();
initRemoveBgModule();
  initUpscalerModule();
initQrModule();
initBratModule();

export { guardActionAgainstAdblock };




// tab-upscaler-fallback
(() => {
  const PANELS = ["tab-downloader","tab-removebg","tab-upscaler","tab-qrstudio","qrTextMode","qrPhotoMode","qrPreviewWrap","qrCanvasContainer"];
  function resolveTarget(btn) {
    const raw = (btn.dataset.tab || btn.dataset.target || btn.dataset.panel || btn.textContent || "").trim().toLowerCase();
    if (raw.includes("download")) return PANELS.find((p) => p.includes("downloader"));
    if (raw.includes("remove")) return PANELS.find((p) => p.includes("removebg"));
    if (raw.includes("hd") || raw.includes("upscal")) return PANELS.find((p) => p.includes("upscaler"));
    if (raw.includes("qr")) return PANELS.find((p) => p.includes("qr"));
    return null;
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const targetId = resolveTarget(btn);
    if (!targetId) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    document.querySelectorAll("button").forEach((b) => {
      if (resolveTarget(b)) {
        b.classList.toggle("active", b === btn);
      }
    });

    PANELS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const show = id === targetId;
      el.classList.toggle("hidden", !show);
      el.classList.toggle("active", show);
      el.style.display = show ? "" : "none";
    });
  }, true);
})();
