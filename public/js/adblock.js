let adblockDetected = false;

export function initAdSystem() {
  const modal = document.getElementById("adblockModal");
  const btnReload = document.getElementById("btnReloadPage");

  if (btnReload) {
    btnReload.addEventListener("click", () => window.location.reload());
  }

  if (window.__7D_ADS_ENABLED__ === true) {
    const bait = document.createElement("div");
    bait.className = "pub_300x250 pub_300x250m text-ad textAd";
    bait.style.cssText =
      "width:1px!important;height:1px!important;position:absolute!important;left:-9999px!important;top:-9999px!important;";
    document.body.appendChild(bait);

    setTimeout(() => {
      const blocked =
        !bait.parentNode ||
        bait.offsetHeight === 0 ||
        window.getComputedStyle(bait).display === "none";

      bait.remove();

      if (blocked) {
        adblockDetected = true;
        modal?.classList.remove("hidden");
      }
    }, 800);
  }

  refreshAdSlotsOnTabSwitch();
}

export function guardActionAgainstAdblock() {
  if (adblockDetected) {
    document.getElementById("adblockModal")?.classList.remove("hidden");
    return false;
  }
  return true;
}

export function refreshAdSlotsOnTabSwitch() {
  const slots = ["adSlot1", "adSlot2", "adSlot3", "adSlot4"];
  slots.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const hasContent = el.innerHTML.trim().length > 0;
    el.classList.toggle("empty", !hasContent);
  });

  const s3 = document.getElementById("adSlot3");
  const s4 = document.getElementById("adSlot4");
  const footerGrid = document.getElementById("adFooterGrid");
  if (footerGrid && s3 && s4) {
    const bothEmpty = s3.classList.contains("empty") && s4.classList.contains("empty");
    footerGrid.classList.toggle("empty", bothEmpty);
  }
}
