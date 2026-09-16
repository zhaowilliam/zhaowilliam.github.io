(() => {
  "use strict";

  const eventLabels = {
    page_view: "Page view", cv_download: "CV click", paper_click: "Paper click",
    outbound_click: "External link", contact_click: "Contact click", navigation_click: "Navigation",
    section_view: "Section visible", scroll_depth: "Scroll depth", engagement: "Foreground time",
    video_progress: "Video progress", resource_error: "Loading / script error", page_performance: "Page load",
    teaser_play: "Teaser start", hess_video_open: "Full-video open", video_doi_click: "Video DOI click", map_click: "Map click",
  };

  function detailsFor(row) {
    return row.details && typeof row.details === "object" && !Array.isArray(row.details) ? row.details : {};
  }

  function channelFor(row) {
    const detail = detailsFor(row);
    return detail.utm_source
      ? [detail.utm_source, detail.utm_medium, detail.utm_campaign].filter(Boolean).join(" / ")
      : (Object.hasOwn(detail, "entry_referrer") ? detail.entry_referrer : row.referrer_domain) || "Direct / unknown";
  }

  function rank(rows, label) {
    const counts = new Map();
    for (const row of rows) {
      const key = label(row) || "Not recorded";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  }

  function orderEvents(rows) {
    return [...rows].sort((a, b) => String(a.timestamp_utc).localeCompare(String(b.timestamp_utc)) || Number(a.id) - Number(b.id));
  }

  function rankPapers(rows) {
    const papers = new Map();
    for (const row of rows) {
      const title = String(detailsFor(row).label || "").trim();
      const fallback = String(row.target || title || "Not recorded").trim();
      const key = fallback.replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, "").toLowerCase();
      if (!papers.has(key)) papers.set(key, { label: title || fallback, titled: Boolean(title), count: 0 });
      const paper = papers.get(key);
      paper.count += 1;
      if (title && (!paper.titled || title.length > paper.label.length)) {
        paper.label = title;
        paper.titled = true;
      }
    }
    return [...papers.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).map((paper) => [paper.label, paper.count]);
  }

  function summarizeActivity(rows) {
    const views = rows.filter((row) => row.event === "page_view");
    const sessions = new Map();
    for (const row of orderEvents(rows)) {
      if (!row.session_id) continue;
      if (!sessions.has(row.session_id)) sessions.set(row.session_id, []);
      sessions.get(row.session_id).push(row);
    }
    for (const session of sessions.values()) {
      if (session.every((row) => Number.isSafeInteger(detailsFor(row).sequence) && detailsFor(row).sequence > 0)) {
        session.sort((a, b) => detailsFor(a).sequence - detailsFor(b).sequence || String(a.timestamp_utc).localeCompare(String(b.timestamp_utc)) || Number(a.id) - Number(b.id));
      }
    }
    const eligibleSessions = new Set(views.map((row) => row.session_id).filter(Boolean));
    const converted = (event) => new Set(rows.filter((row) => row.event === event && eligibleSessions.has(row.session_id)).map((row) => row.session_id)).size;
    const papers = rows.filter((row) => row.event === "paper_click");
    const performance = rows.filter((row) => row.event === "page_performance")
      .map((row) => detailsFor(row).load_ms).filter((ms) => typeof ms === "number" && Number.isFinite(ms) && ms >= 0).sort((a, b) => a - b);
    const middle = Math.floor(performance.length / 2);
    const medianLoad = !performance.length ? null : performance.length % 2 ? performance[middle] : (performance[middle - 1] + performance[middle]) / 2;
    return {
      views: views.length, sessions, eligibleSessions: eligibleSessions.size,
      cvSessions: converted("cv_download"), contactSessions: converted("contact_click"),
      legacy: rows.filter((row) => !row.session_id).length,
      papers: rankPapers(papers),
      topics: rank(papers, (row) => detailsFor(row).topic),
      channels: rank(views, channelFor),
      devices: rank(views, (row) => [detailsFor(row).device, detailsFor(row).browser, detailsFor(row).viewport].filter(Boolean).join(" / ")),
      problems: rank(rows.filter((row) => row.event === "resource_error"), (row) => [detailsFor(row).error_kind, row.path, detailsFor(row).link_url || row.target].filter(Boolean).join(" · ")),
      sections: rank(rows.filter((row) => row.event === "section_view"), (row) => [row.path, row.target].filter(Boolean).join(" ")),
      foregroundSeconds: rows.filter((row) => row.event === "engagement").reduce((total, row) => total + (Number.isFinite(detailsFor(row).seconds) ? Math.max(0, detailsFor(row).seconds) : 0), 0),
      medianLoad, performanceSamples: performance.length,
    };
  }

  function formatDateTime(value) {
    if (!value) return "Unknown time";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown time";
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "short",
    }).formatToParts(date).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName}`;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { summarizeActivity, formatDateTime, orderEvents, channelFor };
  if (typeof document === "undefined") return;

  const form = document.querySelector("#analytics-export-form");
  const status = document.querySelector("#analytics-export-status");
  const mapElement = document.querySelector("#private-visitor-map");
  const mapDetail = document.querySelector("#private-map-detail");
  const report = document.querySelector("#analytics-activity-report");
  const exclusionButton = document.querySelector("#analytics-exclude-browser");
  const exclusionStatus = document.querySelector("#analytics-exclude-status");
  const endpoint = document
    .querySelector('meta[name="analytics-endpoint"]')
    ?.content.trim()
    .replace(/\/$/u, "");
  let visitorMap;
  let visitorLayer;
  let pendingRequest;

  if (!form || !status) return;

  function updateExclusion(toggle = false) {
    if (!exclusionButton || !exclusionStatus) return;
    try {
      if (toggle) {
        if (localStorage.getItem("wenli.analytics.disabled") === "1") localStorage.removeItem("wenli.analytics.disabled");
        else localStorage.setItem("wenli.analytics.disabled", "1");
      }
      const excluded = localStorage.getItem("wenli.analytics.disabled") === "1";
      exclusionButton.textContent = excluded ? "Include this browser in analytics" : "Exclude this browser from analytics";
      exclusionButton.setAttribute("aria-pressed", String(excluded));
      exclusionStatus.textContent = excluded
        ? "This browser is excluded. Reload any already-open public website tabs for the change to apply."
        : "This browser is not excluded here. Browser privacy preferences are still respected.";
    } catch {
      exclusionStatus.textContent = "Browser storage is unavailable; this exclusion preference could not be read or saved.";
      exclusionButton.disabled = true;
    }
  }
  updateExclusion();
  exclusionButton?.addEventListener("click", () => updateExclusion(true));

  function clearPrivateData() {
    report?.replaceChildren();
    if (report) report.hidden = true;
    visitorLayer?.clearLayers();
    if (mapElement) mapElement.hidden = true;
    if (mapDetail) {
      mapDetail.textContent = "";
      mapDetail.hidden = true;
    }
  }
  window.addEventListener("pagehide", () => {
    pendingRequest?.abort();
    clearPrivateData();
    form.reset();
    status.textContent = "Private results cleared. Enter your token to load a new report.";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pendingRequest) return;
    const token = new FormData(form).get("token")?.toString().trim();
    const action = event.submitter?.value || "activity";
    clearPrivateData();

    if (!endpoint) {
      status.textContent = "The private export endpoint has not been deployed yet.";
      return;
    }
    if (!token) {
      status.textContent = "Enter the private export token.";
      return;
    }

    status.textContent = action === "map" ? "Loading visitor locations…" : action === "activity" ? "Loading private activity…" : "Preparing export…";
    pendingRequest = new AbortController();
    form.querySelectorAll('button[type="submit"]').forEach((button) => { button.disabled = true; });

    try {
      if (action === "activity") {
        const result = await fetchActivity(token);
        renderActivity(result);
        status.textContent = `Loaded ${result.events.length.toLocaleString()} records from the last 30 days${result.truncated ? "; the 10,000-record limit was reached, so this report is partial" : ""}. All times show server receipt in New York time. The token was not saved.`;
      } else if (action === "map") {
        const locations = await fetchLocations(token);
        renderMap(locations);
        status.textContent = locations.length
          ? `Map loaded with ${locations.length} approximate city-level location${locations.length === 1 ? "" : "s"}. The map endpoint does not return IP addresses.`
          : "No records with approximate coordinates are available yet.";
      } else {
        const csv = await fetchAllCsv(token, (page) => {
          status.textContent = `Preparing export batch ${page}…`;
        });
        downloadCsv(csv);
        status.textContent = "CSV downloaded. The token was not persisted. Delete this local CSV within 30 days.";
      }
    } catch (error) {
      clearPrivateData();
      status.textContent = error.name === "AbortError" ? "The request was cancelled." : error.message;
    } finally {
      pendingRequest = null;
      form.querySelectorAll('button[type="submit"]').forEach((button) => { button.disabled = false; });
      form.reset();
    }
  });

  async function fetchActivity(token) {
    const events = [];
    const ids = new Set();
    let before = null;
    while (events.length < 10000) {
      const query = new URLSearchParams({ limit: "1000", days: "30" });
      if (before !== null) query.set("before", String(before));
      const response = await fetch(`${endpoint}/events.json?${query}`, {
        headers: { Authorization: `Bearer ${token}` }, credentials: "omit", cache: "no-store", signal: pendingRequest.signal,
      });
      if (!response.ok) throw new Error(response.status === 401 ? "The token was not accepted." : "The activity report could not be loaded.");
      const payload = await response.json();
      if (!Array.isArray(payload.events) || payload.events.length > 1000 || payload.days !== 30) throw new Error("The activity report response was invalid.");
      for (const row of payload.events) {
        if (!row || !Number.isSafeInteger(row.id) || row.id < 1 || (before !== null && row.id >= before) || ids.has(row.id)) throw new Error("The activity report pagination was invalid.");
        ids.add(row.id);
        events.push(row);
      }
      const next = payload.next_before;
      if (next === null || next === undefined) return { events, truncated: false };
      if (!payload.events.length || !Number.isSafeInteger(next) || next < 1 || next !== Math.min(...payload.events.map((row) => row.id)) || (before !== null && next >= before)) throw new Error("The activity report pagination was invalid.");
      before = next;
      status.textContent = `Loading private activity… ${events.length.toLocaleString()} records received.`;
    }
    return { events, truncated: true };
  }

  function append(parent, tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    parent.append(element);
    return element;
  }

  function table(parent, headings, rows) {
    const wrap = append(parent, "div", undefined, "activity-table-wrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", `${headings.join(", ")} table; scroll horizontally if needed`);
    const element = append(wrap, "table", undefined, "activity-table");
    const head = append(append(element, "thead"), "tr");
    headings.forEach((label) => { append(head, "th", label).scope = "col"; });
    const body = append(element, "tbody");
    for (const cells of rows) {
      const row = append(body, "tr");
      cells.forEach((value) => append(row, "td", value ?? "Not recorded"));
    }
  }

  function locationFor(row) {
    return [[row.city, row.region, row.country].filter(Boolean).join(", "), row.as_organization].filter(Boolean).join(" · ") || "Location / network not recorded";
  }

  function describeEvent(row) {
    const detail = detailsFor(row);
    const extra = [detail.label || row.target, detail.placement];
    if (Number.isFinite(detail.percent)) extra.push(`${detail.percent}%`);
    if (Number.isFinite(detail.seconds)) extra.push(`${detail.seconds}s`);
    if (Number.isFinite(detail.load_ms)) extra.push(`${detail.load_ms}ms`);
    if (detail.error_kind) extra.push(detail.error_kind);
    return [eventLabels[row.event] || row.event, ...extra].filter(Boolean).join(" · ");
  }

  function renderActivity({ events, truncated }) {
    if (!report) return;
    report.hidden = false;
    if (!events.length) {
      append(report, "p", "No activity records were returned for the last 30 days.");
      return;
    }
    const summary = summarizeActivity(events);
    const ordered = orderEvents(events);
    append(report, "p", `Last 30 days; loaded records span ${formatDateTime(ordered[0].timestamp_utc)} to ${formatDateTime(ordered.at(-1).timestamp_utc)}. ${truncated ? "Partial report: only the newest 10,000 records are included. " : ""}Every summary below uses only these loaded records. ${summary.legacy} records have no session ID and are excluded from session-based rates.`, "activity-note");
    const cards = append(report, "div", undefined, "activity-cards");
    const rate = (count) => summary.eligibleSessions ? `${(count / summary.eligibleSessions * 100).toFixed(1)}%` : "Not available";
    for (const [value, label] of [
      [summary.views, "Recorded pageviews (reloads included)"],
      [summary.sessions.size, "Distinct recorded sessions, not people"],
      [rate(summary.cvSessions), `CV-click sessions: ${summary.cvSessions} / ${summary.eligibleSessions} sessions with a recorded pageview`],
      [rate(summary.contactSessions), `Contact-click sessions: ${summary.contactSessions} / ${summary.eligibleSessions} sessions with a recorded pageview`],
    ]) {
      const card = append(cards, "div", undefined, "activity-card");
      append(card, "strong", value);
      append(card, "p", label);
    }
    const grid = append(report, "div", undefined, "activity-grid");
    for (const [title, label, countLabel, ranking] of [
      ["Paper interest", "Paper", "Clicks", summary.papers],
      ["Research topics", "Topic", "Paper clicks", summary.topics],
      ["Channels", "UTM source / medium / campaign, or entry referrer", "Pageviews", summary.channels],
      ["Devices", "Device / browser / viewport group", "Pageviews", summary.devices],
      ["Visible sections", "Page / section", "Visibility events", summary.sections],
      ["Observed problems", "Kind / page / resource", "Events", summary.problems],
    ]) {
      const panel = append(grid, "section", undefined, "activity-panel");
      append(panel, "h3", title);
      if (ranking.length) table(panel, [label, countLabel], ranking.slice(0, 10));
      else append(panel, "p", "No matching records yet.");
      if (ranking.length > 10) append(panel, "p", `Top 10 of ${ranking.length} groups shown.`, "activity-note");
    }
    append(report, "p", `Recorded foreground time: ${Math.round(summary.foregroundSeconds)} seconds total. This measures tab visibility, not proof of reading. Median page load: ${summary.medianLoad === null ? "not recorded" : `${Math.round(summary.medianLoad)} ms across ${summary.performanceSamples} samples`}. Channels count pageviews, not unique visitors; a missing referrer does not prove direct access.`, "activity-note");
    const sessions = append(report, "section", undefined, "activity-section");
    append(sessions, "h3", "Recent session paths");
    append(sessions, "p", "Up to 20 most recently received sessions; each path shows at most its last 20 loaded events. Paths use browser sequence when every event has one, otherwise server receipt order. Times show server receipt, so network delays may make them differ from click order. Paths can extend outside the report window. Session IDs are anonymous visit identifiers, not names; a session may include multiple IP addresses.");
    const recentSessions = [...summary.sessions].map(([id, rows]) => ({ id, rows, last: orderEvents(rows).at(-1) }))
      .sort((a, b) => String(b.last.timestamp_utc).localeCompare(String(a.last.timestamp_utc))).slice(0, 20);
    if (!recentSessions.length) append(sessions, "p", "No session IDs are available in these records. Historical IPs are not used to invent session paths.");
    for (const { id, rows, last } of recentSessions) {
      const container = append(sessions, "details", undefined, "activity-session");
      append(container, "summary", `${formatDateTime(last.timestamp_utc)} · ${locationFor(last)} · ${rows.length} events · Session ${id}`);
      if (rows.length > 20) append(container, "p", `${rows.length - 20} earlier loaded events omitted from this path.`, "activity-note");
      const list = append(container, "ol");
      for (const row of rows.slice(-20)) append(list, "li", `${formatDateTime(row.timestamp_utc)} | ${row.path || "/"} | ${describeEvent(row)} | IP ${row.ip || "not retained"} | ${locationFor(row)} | ${channelFor(row)}`);
    }
    const activity = append(report, "section", undefined, "activity-section");
    append(activity, "h3", "Latest activity");
    append(activity, "p", `Showing the latest ${Math.min(events.length, 200)} of ${events.length} loaded events, most recently received first. Times are server receipt in New York time (EDT or EST), not the visitor's local time or exact click time. Locations are approximate network geolocation, not street addresses. Network affiliation does not identify the visitor or their employer.`);
    table(activity, ["Received (New York)", "IP", "Approximate location / network", "Action / page", "Source"], ordered.slice(-200).reverse().map((row) => [formatDateTime(row.timestamp_utc), row.ip || "Not retained", locationFor(row), `${describeEvent(row)} · ${row.path || "/"}`, channelFor(row)]));
  }

  async function fetchLocations(token) {
    const response = await fetch(`${endpoint}/locations.json`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "omit",
      cache: "no-store",
      signal: pendingRequest.signal,
    });
    if (!response.ok) throw new Error(response.status === 401 ? "The token was not accepted." : "The visitor map could not be prepared.");

    const payload = await response.json();
    if (!Array.isArray(payload.locations)) throw new Error("The visitor map response was invalid.");

    return payload.locations.flatMap((location) => {
      const latitude = Number(location.latitude);
      const longitude = Number(location.longitude);
      const visitors = Number(location.visitors);
      const pageViews = Number(location.page_views);
      if (
        !Number.isFinite(latitude)
        || latitude < -90
        || latitude > 90
        || !Number.isFinite(longitude)
        || longitude < -180
        || longitude > 180
        || !Number.isSafeInteger(visitors)
        || visitors < 1
        || !Number.isSafeInteger(pageViews)
        || pageViews < 1
      ) return [];

      return [{
        latitude,
        longitude,
        visitors,
        pageViews,
        city: location.city || "",
        region: location.region || "",
        country: location.country || "",
        lastSeen: location.last_seen || "",
      }];
    });
  }

  async function fetchAllCsv(token, onPage) {
    const chunks = [];
    let before = null;
    let page = 1;

    while (true) {
      onPage(page);
      const query = new URLSearchParams({ limit: "5000" });
      if (before) query.set("before", before);

      const response = await fetch(`${endpoint}/export.csv?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "omit",
        cache: "no-store",
        signal: pendingRequest.signal,
      });
      if (!response.ok) throw new Error(response.status === 401 ? "The token was not accepted." : "The export could not be prepared.");

      const csv = await response.text();
      if (page === 1) {
        chunks.push(csv);
      } else {
        const firstBreak = csv.indexOf("\r\n");
        if (firstBreak >= 0 && firstBreak < csv.length - 2) chunks.push(csv.slice(firstBreak + 2));
      }

      const nextBefore = response.headers.get("X-Next-Before");
      if (!nextBefore || nextBefore === before) break;
      before = nextBefore;
      page += 1;
    }

    return chunks.join("\r\n");
  }

  function renderMap(locations) {
    if (!mapElement || !mapDetail || !window.L) {
      throw new Error("The interactive map could not be loaded.");
    }

    mapElement.hidden = false;
    mapDetail.hidden = true;

    if (!visitorMap) {
      visitorMap = window.L.map(mapElement, {
        preferCanvas: false,
        scrollWheelZoom: true,
        worldCopyJump: true,
      }).setView([20, 0], 2);

      window.L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          attribution:
            '<a href="https://goto.arcgisonline.com/maps/World_Imagery" target="_blank" rel="noopener">Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community</a>',
        },
      ).addTo(visitorMap);
      visitorLayer = window.L.layerGroup().addTo(visitorMap);
    } else {
      visitorLayer.clearLayers();
    }

    const bounds = window.L.latLngBounds([]);

    locations.forEach((location) => {
      const label = [location.city, location.region, location.country].filter(Boolean).join(", ");
      const visitors = location.visitors;
      const pageViews = location.pageViews;
      const lastSeen = formatDateTime(location.lastSeen);
      const details = `${label || "Approximate location"}: ${visitors} approximate visitor${visitors === 1 ? "" : "s"}, ${pageViews} page view${pageViews === 1 ? "" : "s"}. Latest visit: ${lastSeen || "unknown"}.`;
      const popup = document.createElement("p");
      popup.textContent = details;
      const marker = window.L.circleMarker([location.latitude, location.longitude], {
        radius: Math.min(18, 6 + Math.log2(visitors + 1) * 2),
        color: "#103a42",
        weight: 2,
        fillColor: "#d99a3e",
        fillOpacity: 0.9,
      });
      const tooltip = document.createElement("span");
      tooltip.textContent = label || "Approximate visitor location";
      marker.bindTooltip(tooltip);
      marker.bindPopup(popup);
      const showDetails = () => {
        mapDetail.textContent = details;
        mapDetail.hidden = false;
      };
      marker.on("click", showDetails);
      marker.addTo(visitorLayer);

      const markerElement = marker.getElement();
      if (markerElement) {
        markerElement.setAttribute("tabindex", "0");
        markerElement.setAttribute("role", "button");
        markerElement.setAttribute("aria-label", details);
        markerElement.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          marker.openPopup();
          showDetails();
        });
      }
      bounds.extend(marker.getLatLng());
    });

    requestAnimationFrame(() => {
      visitorMap.invalidateSize({ pan: false });
      if (locations.length === 0) {
        visitorMap.setView([20, 0], 2);
      } else if (locations.length === 1) {
        visitorMap.setView(bounds.getCenter(), 5);
      } else {
        visitorMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 7 });
      }
    });
  }

  function downloadCsv(csv) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `wenli-site-events-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(downloadUrl);
  }

})();
