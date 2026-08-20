(() => {
  "use strict";

  const form = document.querySelector("#analytics-export-form");
  const status = document.querySelector("#analytics-export-status");
  const mapElement = document.querySelector("#private-visitor-map");
  const mapDetail = document.querySelector("#private-map-detail");
  const endpoint = document
    .querySelector('meta[name="analytics-endpoint"]')
    ?.content.trim()
    .replace(/\/$/u, "");
  let visitorMap;
  let visitorLayer;

  if (!form || !status) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = new FormData(form).get("token")?.toString().trim();
    const action = event.submitter?.value || "map";

    if (!endpoint) {
      status.textContent = "The private export endpoint has not been deployed yet.";
      return;
    }
    if (!token) {
      status.textContent = "Enter the private export token.";
      return;
    }

    status.textContent = action === "map" ? "Loading visitor locations…" : "Preparing export…";

    try {
      if (action === "map") {
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
      status.textContent = error.message;
    } finally {
      form.reset();
    }
  });

  async function fetchLocations(token) {
    const response = await fetch(`${endpoint}/locations.json`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "omit",
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
      marker.bindTooltip(label || "Approximate visitor location");
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

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
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
