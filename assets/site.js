(() => {
  "use strict";

  const activeCounters = new Set();
  const countedLinks = new WeakSet();
  const sessionKey = "wenli.analytics.session";
  const slug = (value) => /^[a-z0-9_-]{1,64}$/iu.test(value || "") ? value : undefined;
  const compact = (value) => String(value || "").replace(/\s+/gu, " ").trim().slice(0, 160);
  const analyticsEndpoint = document.querySelector('meta[name="analytics-endpoint"]')?.content.trim().replace(/\/$/u, "");
  let session;
  let pageId;
  let sent = 0;

  function enabled() {
    if (window.location.hostname !== "zhaowilliam.github.io" || /\/analytics(?:\.html)?\/?$/u.test(window.location.pathname) || navigator.globalPrivacyControl === true || navigator.doNotTrack === "1") return false;
    try { return localStorage.getItem("wenli.analytics.disabled") !== "1"; }
    catch { return true; } // Storage may be unavailable; use an in-memory session only.
  }

  function countEvent(id) {
    try {
      if (!enabled() || !id) return;
      const pixel = new Image(1, 1);
      activeCounters.add(pixel);
      pixel.onload = pixel.onerror = () => activeCounters.delete(pixel);
      pixel.src = `https://visitor-badge.laobi.icu/badge?page_id=${encodeURIComponent(id)}&left_text=event&t=${Date.now()}`;
    } catch { /* Analytics must never interrupt navigation or playback. */ }
  }

  function currentSession() {
    const now = Date.now();
    if (!session) {
      try { session = JSON.parse(sessionStorage.getItem(sessionKey)); } catch { /* Private browsing/storage restrictions. */ }
    }
    if (!session || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu.test(session.id || "") ||
        !Number.isFinite(session.created) || !Number.isFinite(session.last) ||
        now - session.last >= 30 * 60 * 1000 || now - session.created >= 8 * 60 * 60 * 1000 ||
        now < session.last || now < session.created || !Number.isInteger(session.sequence) || session.sequence < 0 || session.sequence >= 10000) {
      session = { id: crypto.randomUUID(), created: now, last: now, sequence: 0, campaign: {} };
    }
    session.last = now;
    session.sequence += 1;
    const entryReferrer = session.entry_referrer === undefined ? referrerDomain() : session.entry_referrer;
    session.entry_referrer = typeof entryReferrer === "string" && entryReferrer.length <= 253 &&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(entryReferrer) &&
      entryReferrer.toLowerCase() !== window.location.hostname ? entryReferrer.toLowerCase() : null;
    const params = new URLSearchParams(window.location.search);
    const campaign = {};
    for (const key of ["utm_source", "utm_medium", "utm_campaign"]) {
      const value = slug(params.get(key)) || slug(session.campaign?.[key]);
      if (value) campaign[key] = value;
    }
    session.campaign = campaign;
    try { sessionStorage.setItem(sessionKey, JSON.stringify(session)); } catch { /* Continue without persistence. */ }
    return session;
  }

  function referrerDomain() {
    try { return new URL(document.referrer).hostname.toLowerCase(); }
    catch { return null; }
  }

  function track(event, target = null, details = {}) {
    try {
      if (!enabled() || !analyticsEndpoint || sent >= 100) return;
      const visit = currentSession();
      pageId ||= crypto.randomUUID();
      const payload = JSON.stringify({
        event, path: window.location.pathname || "/", target: target?.slice(0, 160) || null,
        referrer_domain: referrerDomain(), event_id: crypto.randomUUID(), session_id: visit.id,
        details: { ...details, ...visit.campaign, entry_referrer: visit.entry_referrer, page_id: pageId, sequence: visit.sequence },
      });
      const body = new Blob([payload], { type: "text/plain;charset=UTF-8" });
      if (body.size > 4096) return;
      sent += 1;
      try { if (navigator.sendBeacon?.(`${analyticsEndpoint}/collect`, body)) return; } catch { /* Fetch fallback. */ }
      fetch(`${analyticsEndpoint}/collect`, {
        method: "POST", mode: "cors", credentials: "omit", keepalive: true,
        headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: payload,
      }).catch(() => {});
    } catch { /* No storage, networking, or analytics error may affect the site. */ }
  }

  function safeUrl(raw) {
    try {
      if (!raw || typeof raw !== "string") return undefined;
      const url = new URL(raw, window.location.href);
      return /^https?:$/u.test(url.protocol) ? `${url.origin}${url.pathname}` : undefined;
    } catch { return undefined; }
  }

  function placement(element) {
    if (element.closest("header")) return "header";
    if (element.closest("footer")) return "footer";
    const section = element.closest("section");
    return slug(section?.id || section?.getAttribute("aria-labelledby")) || "body";
  }

  // Explicit subject groupings, not inferred visitor identities or research interests.
  const paperTopics = {
    "10.5194/hess-30-5373-2026": "water-cycle",
    "10.1029/2025wr041406": "snow-hydrology",
    "10.1038/s41597-025-05978-7": "energy-carbon",
    "10.1088/1748-9326/ae33d3": "water-cycle",
    "10.1038/s43247-023-01147-z": "energy-carbon",
    "10.1175/jhm-d-19-0191.1": "water-cycle",
    "10.1029/2019gl085291": "water-cycle",
    "10.1038/s41467-026-73395-4": "land-modeling",
    "10.1038/s41467-026-75637-x": "water-cycle",
    "10.1038/s41558-026-02606-z": "energy-carbon",
    "10.1038/s41467-025-59879-9": "energy-carbon",
    "10.1111/gcb.70462": "land-modeling",
    "10.1038/s41597-023-02094-2": "energy-carbon",
    "10.1038/s41467-022-35414-y": "water-cycle",
    "10.5194/essd-14-3673-2022": "water-cycle",
    "10.2139/ssrn.6852378": "land-energy",
    "10.2139/ssrn.5405302": "energy-carbon",
    "10.5194/egusphere-2024-3726": "land-modeling",
  };

  function linkClick(event) {
    try {
      if ((event.type === "auxclick" && event.button !== 1) || (event.type === "click" && event.button > 0) || !enabled()) return;
      const link = event.target.closest?.("a[href]");
      if (!link) return;
      if (link.dataset.counter && !countedLinks.has(link)) {
        countedLinks.add(link);
        countEvent(link.dataset.counter);
      }
      const url = new URL(link.href, window.location.href);
      const details = { placement: placement(link), label: compact(link.getAttribute("aria-label") || link.textContent) };
      if (url.protocol === "mailto:") {
        track("contact_click", "email", { ...details, label: "Email", link_url: "mailto" });
        return;
      }
      if (!/^https?:$/u.test(url.protocol)) return;
      details.link_url = safeUrl(url.href);
      if (/^https?:\/\//iu.test(details.label)) details.label = compact(safeUrl(details.label));
      if (link.dataset.analyticsEvent === "cv_download" || (url.origin === window.location.origin && url.pathname === "/assets/documents/Wenli_Zhao_CV.pdf")) {
        track("cv_download", link.dataset.analyticsTarget || details.placement, details);
      } else if (link.dataset.analyticsEvent === "video_doi_click") {
        track(link.dataset.analyticsEvent, link.dataset.analyticsTarget || null, details);
      } else if (["doi.org", "dx.doi.org"].includes(url.hostname)) {
        const doi = url.pathname.slice(1);
        if (doi === "10.5446/73776") {
          track("video_doi_click", "hess-video-abstract", details);
          return;
        }
        const container = link.closest("article, li");
        details.label = compact(container?.querySelector("h3, h2, strong")?.textContent || details.label);
        details.topic = slug(link.dataset.analyticsTopic) || paperTopics[doi.toLowerCase()] || "other-research";
        track("paper_click", doi, details);
      } else if (url.origin === window.location.origin) {
        const section = slug(url.hash.slice(1));
        track("navigation_click", `${url.pathname}${section ? `#${section}` : ""}`, details);
      } else {
        track("outbound_click", url.hostname, details);
      }
    } catch { /* Never delay or prevent the link's default action. */ }
  }

  document.addEventListener("click", linkClick);
  document.addEventListener("auxclick", linkClick);

  // Public video controls stay functional even when analytics is disabled or unavailable.
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
    const milestones = new Set();
    const videoProgress = () => {
      try {
        if (!enabled() || !Number.isFinite(teaser.duration) || teaser.duration <= 0) return;
        let seconds = 0;
        for (let i = 0; i < teaser.played.length; i += 1) seconds += teaser.played.end(i) - teaser.played.start(i);
        for (const percent of [25, 50, 75, 100]) {
          // played ranges measure traversed media, so seeking alone never counts as viewing.
          const reached = seconds >= teaser.duration * percent / 100 - (percent === 100 ? 0.15 : 0);
          if (reached && !milestones.has(percent)) {
            milestones.add(percent);
            track("video_progress", "ef-memory-teaser", { percent, seconds: Math.min(28800, Math.round(seconds)) });
          }
        }
      } catch { /* Unsupported media telemetry must not affect playback. */ }
    };
    teaser.addEventListener("timeupdate", videoProgress);
    teaser.addEventListener("ended", videoProgress);
  }

  if (!enabled()) return;
  try {
    const ua = navigator.userAgent || "";
    const device = /iPad|Tablet|Android(?!.*Mobile)/iu.test(ua) ? "tablet" : /Mobi|iPhone|Android/iu.test(ua) ? "mobile" : "desktop";
    const browser = /Edg\//u.test(ua) ? "edge" : /Firefox\//u.test(ua) ? "firefox" : /Chrome\//u.test(ua) ? "chrome" : /Safari\//u.test(ua) ? "safari" : "other";
    const viewport = window.innerWidth < 640 ? "small" : window.innerWidth < 1024 ? "medium" : "large";
    if (window.location.pathname === "/" || window.location.pathname.endsWith("/index.html")) countEvent("zhaowilliam.home.live.2026");
    track("page_view", document.body.dataset.analyticsPage || null, { device, viewport, browser });

    const sectionTimers = new Map();
    const exposed = new Set();
    const visibleSections = new Map();
    const scheduleSection = (element, id) => {
      if (document.visibilityState !== "visible" || sectionTimers.has(element) || exposed.has(id)) return;
      sectionTimers.set(element, setTimeout(() => {
        sectionTimers.delete(element);
        if (document.visibilityState === "visible" && visibleSections.has(element) && !exposed.has(id)) {
          exposed.add(id);
          track("section_view", id);
        }
      }, 1000));
    };
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const id = entry.target.dataset.analyticsSection;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            visibleSections.set(entry.target, id);
            scheduleSection(entry.target, id);
          } else {
            visibleSections.delete(entry.target);
            clearTimeout(sectionTimers.get(entry.target));
            sectionTimers.delete(entry.target);
          }
        }
      }, { threshold: [0, 0.5, 1] });
      // Observe section headings, not whole tall sections that may never be 50% visible.
      document.querySelectorAll("main section[id], main section[aria-labelledby], footer").forEach((section) => {
        const id = slug(section.id || section.getAttribute("aria-labelledby")) || "contact";
        const element = section.querySelector("h1, h2") || section;
        element.dataset.analyticsSection = id;
        observer.observe(element);
      });
    }

    const depths = new Set();
    let scrollTimer;
    window.addEventListener("scroll", () => {
      if (scrollTimer) return;
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        if (document.visibilityState !== "visible") return;
        const height = document.documentElement.scrollHeight - window.innerHeight;
        if (height <= 0) return;
        const depth = window.scrollY / height * 100;
        for (const percent of [25, 50, 75, 90]) {
          if (depth >= percent && !depths.has(percent)) {
            depths.add(percent);
            track("scroll_depth", "page", { percent });
          }
        }
      }, 250);
    }, { passive: true });

    let visibleSince = document.visibilityState === "visible" ? performance.now() : null;
    const flushEngagement = () => {
      if (visibleSince === null) return;
      const seconds = Math.min(28800, Math.floor((performance.now() - visibleSince) / 1000));
      visibleSince = null;
      if (seconds > 0) track("engagement", "visible-time", { seconds });
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        visibleSince ??= performance.now();
        for (const [element, id] of visibleSections) scheduleSection(element, id);
      } else {
        flushEngagement();
        for (const timer of sectionTimers.values()) clearTimeout(timer);
        sectionTimers.clear();
      }
    });
    window.addEventListener("pagehide", flushEngagement);
    window.addEventListener("pageshow", () => {
      if (document.visibilityState === "visible") visibleSince ??= performance.now();
    });

    const errors = new Set();
    window.addEventListener("error", (event) => {
      try {
        const element = event.target;
        const kind = element === window ? "script" : { IMG: "image", SCRIPT: "script", VIDEO: "video", SOURCE: "video", LINK: "resource" }[element?.tagName];
        if (!kind || errors.size >= 3) return; // No JavaScript exception text, stack, or user input.
        const link = safeUrl(element === window ? event.filename : element.currentSrc || element.src || element.href);
        const key = `${kind}:${link || "unknown"}`;
        if (errors.has(key)) return;
        errors.add(key);
        track("resource_error", kind, { error_kind: kind, link_url: link });
      } catch { /* Nonessential diagnostics. */ }
    }, true);

    const reportPerformance = () => setTimeout(() => {
      try {
        const navigation = performance.getEntriesByType("navigation")[0];
        const load = navigation?.loadEventEnd;
        if (Number.isFinite(load) && load > 0) track("page_performance", "page-load", { load_ms: Math.min(120000, Math.round(load)) });
      } catch { /* Navigation timing is optional. */ }
    }, 0);
    if (document.readyState === "complete") reportPerformance();
    else window.addEventListener("load", reportPerformance, { once: true });
  } catch { /* Optional analytics initialization must not affect public-site functionality. */ }
})();
