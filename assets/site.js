(() => {
  "use strict";

  const activeCounters = new Set();
  const isProduction = window.location.hostname === "zhaowilliam.github.io";

  function countEvent(pageId) {
    if (!isProduction || !pageId) return;

    const pixel = new Image(1, 1);
    activeCounters.add(pixel);
    pixel.onload = pixel.onerror = () => activeCounters.delete(pixel);
    pixel.src = `https://visitor-badge.laobi.icu/badge?page_id=${encodeURIComponent(pageId)}&left_text=event&t=${Date.now()}`;
  }

  countEvent("zhaowilliam.home.live.2026");

  document.querySelectorAll("[data-counter]").forEach((link) => {
    link.addEventListener("click", () => countEvent(link.dataset.counter), { once: true });
  });

  const launch = document.querySelector("#hess-video-launch");
  const frame = document.querySelector("#hess-video-frame");

  if (launch && frame) {
    launch.addEventListener("click", () => {
      countEvent("zhaowilliam.hess-video.play.live.2026");

      const iframe = document.createElement("iframe");
      iframe.src = "https://av.tib.eu/player/73776";
      iframe.title = "Learning Evaporative Fraction with Memory — video abstract";
      iframe.allow = "fullscreen; picture-in-picture";
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      iframe.tabIndex = 0;
      frame.replaceChildren(iframe);
      iframe.addEventListener("load", () => iframe.focus(), { once: true });
    }, { once: true });
  }

  const teaser = document.querySelector("#ef-memory-teaser");

  if (teaser) {
    teaser.addEventListener("contextmenu", (event) => event.preventDefault());
    teaser.addEventListener("play", () => countEvent("zhaowilliam.ef-teaser.play.live.2026"), { once: true });
  }
})();
