import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { groupIPLocations } = require("../assets/analytics-dashboard.js");

test("a location counts distinct IPs and retains every event type, including click-only IPs", () => {
  const location = { latitude: 40.7128, longitude: -74.006, city: "New York", region: "New York", country: "US" };
  const events = [
    "page_view", "cv_download", "paper_click", "outbound_click", "contact_click", "navigation_click",
    "section_view", "scroll_depth", "engagement", "video_progress", "resource_error", "page_performance",
    "teaser_play", "hess_video_open", "video_doi_click", "map_click",
  ];
  const rows = events.map((event, index) => ({ ...location, id: index + 1, ip: "192.0.2.1", event }));
  rows.push({ ...location, id: 17, ip: "192.0.2.1", event: "page_view" });
  rows.push({ ...location, id: 18, ip: "192.0.2.2", event: "contact_click" });

  const result = groupIPLocations(rows);
  assert.equal(result.ipCount, 2);
  assert.equal(result.withoutIP, 0);
  assert.equal(result.locations.length, 1);
  const grouped = result.locations[0];
  assert.equal(grouped.key, JSON.stringify([40.7128, -74.006, "New York", "New York", "US"]));
  assert.equal(grouped.label, "New York, New York, US");
  assert.equal(grouped.ips.size, 2);
  assert.equal(grouped.rows.length, 18);
  assert.equal(grouped.rows.filter((row) => row.event === "page_view").length, 2);
  assert.deepEqual(new Set(grouped.ips.get("192.0.2.1").map((row) => row.event)), new Set(events));
  assert.deepEqual(grouped.ips.get("192.0.2.2"), [rows[17]]);
});

test("the same IP can appear at several locations but counts once globally", () => {
  const rows = [
    { id: 1, ip: "192.0.2.1", latitude: 10, longitude: 20, city: "First", country: "AA" },
    { id: 2, ip: "192.0.2.1", latitude: 30, longitude: 40, city: "Second", country: "BB" },
    { id: 3, ip: "192.0.2.1", latitude: 10, longitude: 20, city: "Other city", country: "AA" },
    { id: 4, ip: "192.0.2.1", latitude: null, longitude: null },
  ];
  const result = groupIPLocations(rows);
  assert.equal(result.ipCount, 1);
  assert.equal(result.locations.length, 4);
  assert.deepEqual(result.locations.map((location) => location.label), [
    "Location unavailable", "Other city, AA", "Second, BB", "First, AA",
  ]);
  assert.ok(result.locations.every((location) => location.ips.size === 1 && location.ips.has("192.0.2.1")));
});

test("missing IPs do not create a fictitious visitor and string IPs are trimmed", () => {
  const missing = [undefined, null, "", " ", "\t\n", false, 123];
  const rows = missing.map((ip, id) => ({ id, ip, latitude: 0, longitude: 0 }));
  rows.push({ id: 8, ip: " 192.0.2.1 ", latitude: 0, longitude: 0 });
  rows.push({ id: 9, ip: "192.0.2.1", latitude: 0, longitude: 0 });
  const result = groupIPLocations(rows);
  assert.equal(result.withoutIP, missing.length);
  assert.equal(result.ipCount, 1);
  assert.equal(result.locations.length, 1);
  assert.deepEqual([...result.locations[0].ips.keys()], ["192.0.2.1"]);
  assert.deepEqual(result.locations[0].rows.map((row) => row.id), [9, 8]);
  assert.equal(rows[7].ip, " 192.0.2.1 ");
});

test("invalid or incomplete coordinates share the unavailable group instead of becoming zero coordinates", () => {
  const coordinates = [
    [null, null], [undefined, 0], [0, undefined], ["", 0], [0, " "], [true, 0], [0, false],
    [NaN, 0], [0, Infinity], [-Infinity, 0], ["Infinity", 0], ["not a number", 0],
    [91, 0], [-91, 0], [0, 181], [0, -181], [[], 0], [0, {}],
  ];
  const rows = coordinates.map(([latitude, longitude], id) => ({
    id, ip: `192.0.2.${id + 1}`, latitude, longitude, city: `Reported city ${id}`,
  }));
  const result = groupIPLocations(rows);
  assert.equal(result.ipCount, coordinates.length);
  assert.equal(result.locations.length, 1);
  const location = result.locations[0];
  assert.equal(location.key, "unlocated");
  assert.equal(location.label, "Location unavailable");
  assert.equal(location.latitude, null);
  assert.equal(location.longitude, null);
  assert.equal(location.rows.length, coordinates.length);
});

test("zero, numeric strings, and inclusive coordinate boundaries remain valid locations", () => {
  const coordinates = [[0, 0], [" 40.7128 ", "-74.006"], [90, 180], [-90, -180]];
  const result = groupIPLocations(coordinates.map(([latitude, longitude], id) => ({
    id, ip: "192.0.2.1", latitude, longitude,
  })));
  assert.equal(result.locations.length, 4);
  assert.deepEqual(result.locations.map(({ latitude, longitude }) => [latitude, longitude]), [
    [-90, -180], [90, 180], [40.7128, -74.006], [0, 0],
  ]);
  assert.ok(result.locations.every((location) => location.label === "Approximate location"));
  assert.equal(result.locations.at(-1).key, JSON.stringify([0, 0, "", "", ""]));
});

test("locations and their IP histories use latest server receipt then ID, without mutating input", () => {
  const first = { ip: "192.0.2.1", latitude: 10, longitude: 20 };
  const second = { ip: "192.0.2.2", latitude: 30, longitude: 40 };
  const rows = Object.freeze([
    Object.freeze({ ...first, id: 2, timestamp_utc: "2026-09-16T12:01:00Z", details: { sequence: 99 } }),
    Object.freeze({ ...second, id: 999, timestamp_utc: "2026-09-16T12:00:00Z" }),
    Object.freeze({ ...first, id: 12, timestamp_utc: "2026-09-16T12:01:00Z", details: { sequence: 1 } }),
    Object.freeze({ ...second, id: 3, timestamp_utc: "2026-09-16T12:02:00Z" }),
    Object.freeze({ ip: "192.0.2.1", id: 1, timestamp_utc: "2026-09-16T12:03:00Z" }),
  ]);
  const result = groupIPLocations(rows);
  assert.deepEqual(result.locations.map((location) => location.rows.map((row) => row.id)), [[1], [3, 999], [12, 2]]);
  assert.deepEqual(result.locations[2].ips.get("192.0.2.1").map((row) => row.id), [12, 2]);
  assert.deepEqual(result.locations[1].ips.get("192.0.2.2").map((row) => row.id), [3, 999]);
  assert.deepEqual(rows.map((row) => row.id), [2, 999, 12, 3, 1]);
});

test("empty input has no locations or fabricated IPs", () => {
  assert.deepEqual(groupIPLocations([]), { locations: [], ipCount: 0, withoutIP: 0 });
});

test("untrusted location and event labels remain literal strings", () => {
  const malicious = '<img src=x onerror="alert(1)">';
  const row = {
    id: 1, ip: "192.0.2.1", latitude: 10, longitude: 20, city: malicious,
    event: "paper_click", target: malicious, details: { label: malicious },
  };
  const location = groupIPLocations([row]).locations[0];
  assert.equal(location.label, malicious);
  assert.equal(location.key, JSON.stringify([10, 20, malicious, "", ""]));
  assert.equal(location.rows[0].target, malicious);
  assert.equal(location.ips.get("192.0.2.1")[0].details.label, malicious);
});
