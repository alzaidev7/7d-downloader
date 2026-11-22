import { initUpscalerModule } from "./modules/upscaler.js?v=9";
import {
  initAdSystem,
  guardActionAgainstAdblock,
  refreshAdSlotsOnTabSwitch,
} from "./adblock.js?v=4";
import { initDownloaderModule } from "./modules/downloader.js?v=4";
import { initRemoveBgModule } from "./modules/removebg.js?v=9";
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
  const MAP = {
    "downloader": "tab-downloader",
    "tab-downloader": "tab-downloader",
    "remove bg": "tab-removebg",
    "removebg": "tab-removebg",
    "tab-removebg": "tab-removebg",
    "hd image": "tab-upscaler",
    "ai upscale": "tab-upscaler",
    "upscaler": "tab-upscaler",
    "tab-upscaler": "tab-upscaler",
    "qr studio": "tab-qr",
    "qr": "tab-qr",
    "tab-qr": "tab-qr"
  };

  function switchTab(targetId, activeBtn) {
    const panels = ["tab-downloader", "tab-removebg", "tab-upscaler", "tab-qr"];
    if (!panels.includes(targetId)) return;

    // Update status active pada semua tombol navigasi
    document.querySelectorAll("header button, nav button, [data-tab], [data-target], [data-panel]").forEach((b) => {
      const label = (b.dataset.tab || b.dataset.target || b.dataset.panel || b.textContent || "").trim().toLowerCase();
      if (MAP[label]) {
        b.classList.toggle("active", b === activeBtn || MAP[label] === targetId);
      }
    });

    // Tampilkan panel yang dipilih & sembunyikan sisanya
    panels.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const show = id === targetId;
      el.classList.toggle("hidden", !show);
      el.classList.toggle("active", show);
      el.style.display = show ? "" : "none";
    });
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const key = (btn.dataset.tab || btn.dataset.target || btn.dataset.panel || btn.textContent || "").trim().toLowerCase();
    const targetId = MAP[key];
    if (targetId) {
      e.preventDefault();
      switchTab(targetId, btn);
    }
  }, true);
})();
