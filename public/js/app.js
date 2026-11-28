import {
  initAdSystem,
  guardActionAgainstAdblock,
  refreshAdSlotsOnTabSwitch,
} from "./adblock.js?v=8";
import { initDownloaderModule } from "./modules/downloader.js?v=8";
import { initRemoveBgModule } from "./modules/removebg.js?v=8";
import { initQrModule } from "./modules/qrstudio.js?v=8";
import { initBratModule } from "./modules/brat.js?v=8";

// 1. Pengalih Tema Dark / Light Mode (Dijalankan Pertama)
const btnTheme = document.getElementById("btnThemeToggle");
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("7d_theme", theme);
  if (btnTheme) {
    btnTheme.innerHTML = theme === "dark" ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>` : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
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
initQrModule();
initBratModule();

export { guardActionAgainstAdblock };
