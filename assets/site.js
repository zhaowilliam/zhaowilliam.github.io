(() => {
  "use strict";

  const activeCounters = new Set();
  const isProduction = window.location.hostname === "zhaowilliam.github.io";
  const analyticsOptOut = navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
  const analyticsEndpoint = document
    .querySelector('meta[name="analytics-endpoint"]')
    ?.content.trim()
    .replace(/\/$/u, "");

  function countEvent(pageId) {
    if (!isProduction || analyticsOptOut || !pageId) return;

    const pixel = new Image(1, 1);
    activeCounters.add(pixel);
    pixel.onload = pixel.onerror = () => activeCounters.delete(pixel);
    pixel.src = `https://visitor-badge.laobi.icu/badge?page_id=${encodeURIComponent(pageId)}&left_text=event&t=${Date.now()}`;
  }

  function referrerDomain() {
    if (!document.referrer) return null;
    try {
      return new URL(document.referrer).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  function track(event, target = null) {
    if (!isProduction || analyticsOptOut || !analyticsEndpoint) return;

    const payload = JSON.stringify({
      event,
      path: window.location.pathname || "/",
      target,
      referrer_domain: referrerDomain(),
    });
    const body = new Blob([payload], { type: "text/plain;charset=UTF-8" });

    if (navigator.sendBeacon?.(`${analyticsEndpoint}/collect`, body)) return;

    fetch(`${analyticsEndpoint}/collect`, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: payload,
    }).catch(() => {});
  }

  const isHomepage = window.location.pathname === "/" || window.location.pathname.endsWith("/index.html");
  if (isHomepage) countEvent("zhaowilliam.home.live.2026");
  track("page_view", document.body.dataset.analyticsPage || null);

  const visitorMap = document.querySelector("[data-visitor-map]");
  if (visitorMap && !analyticsOptOut) visitorMap.src = visitorMap.dataset.src;

  document.querySelectorAll("[data-counter]").forEach((link) => {
    link.addEventListener("click", () => countEvent(link.dataset.counter), { once: true });
  });

  document.querySelectorAll("[data-analytics-event]").forEach((element) => {
    element.addEventListener("click", () => {
      track(element.dataset.analyticsEvent, element.dataset.analyticsTarget || null);
    });
  });

  const launch = document.querySelector("#hess-video-launch");
  const frame = document.querySelector("#hess-video-frame");

  if (launch && frame) {
    launch.addEventListener("click", () => {
      countEvent("zhaowilliam.hess-video.play.live.2026");
      track("hess_video_open", "hess-video-abstract");

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
    teaser.addEventListener("play", () => {
      countEvent("zhaowilliam.ef-teaser.play.live.2026");
      track("teaser_play", "ef-memory-teaser");
    }, { once: true });
  }
})();
