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

  const visitorMapMarkers = document.querySelector("[data-visitor-map-markers]");
  const visitorMapStatus = document.querySelector("[data-visitor-map-status]");

  async function loadPublicVisitorMap() {
    if (!visitorMapMarkers || !visitorMapStatus) return;
    if (analyticsOptOut) {
      visitorMapStatus.textContent = "Visitor regions are hidden by your privacy preference.";
      return;
    }
    if (!analyticsEndpoint) {
      visitorMapStatus.textContent = "Visitor region data are temporarily unavailable.";
      return;
    }

    try {
      visitorMapStatus.textContent = "Loading privacy-protected visitor regions…";
      const response = await fetch(`${analyticsEndpoint}/public-locations.json`, { credentials: "omit" });
      if (!response.ok) throw new Error("Map request failed");
      const payload = await response.json();
      if (!Array.isArray(payload.locations)) throw new Error("Invalid map response");

      const markers = document.createDocumentFragment();
      let count = 0;

      payload.locations.forEach((location) => {
        if (!location || typeof location !== "object") return;
        const latitude = Number(location.latitude);
        const longitude = Number(location.longitude);
        if (
          !Number.isFinite(latitude)
          || latitude < -90
          || latitude > 90
          || !Number.isFinite(longitude)
          || longitude < -180
          || longitude > 180
        ) return;

        const region = typeof location.region === "string" ? location.region : "";
        const country = typeof location.country === "string" ? location.country : "";
        const label = [region, country].filter(Boolean).join(", ") || "Approximate visitor region";
        const marker = document.createElement("span");
        marker.className = "visitor-map-marker";
        marker.setAttribute("role", "listitem");
        marker.setAttribute("aria-label", label);
        marker.title = label;
        marker.style.left = `clamp(0.8rem, ${((longitude + 180) / 360) * 100}%, calc(100% - 0.8rem))`;
        marker.style.top = `clamp(0.8rem, ${((90 - latitude) / 180) * 100}%, calc(100% - 0.8rem))`;
        markers.append(marker);
        count += 1;
      });

      visitorMapMarkers.replaceChildren(markers);
      visitorMapStatus.textContent = count
        ? `Showing ${count} broad visitor region${count === 1 ? "" : "s"}; regions below the configured threshold are withheld.`
        : "No visitor region currently meets the public privacy threshold.";
    } catch {
      visitorMapStatus.textContent = "Visitor region data are temporarily unavailable.";
    }
  }

  void loadPublicVisitorMap();

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
