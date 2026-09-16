import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { summarizeActivity, formatDateTime, orderEvents, channelFor } = require("../assets/analytics-dashboard.js");

test("conversion rates use only sessions with a loaded pageview, not IPs or legacy clicks", () => {
  const rows = [
    { id: 1, event: "page_view", session_id: "a", ip: "shared" },
    { id: 2, event: "page_view", session_id: "a", ip: "changed" },
    { id: 3, event: "cv_download", session_id: "a" },
    { id: 4, event: "cv_download", session_id: "a" },
    { id: 5, event: "page_view", session_id: "b", ip: "shared" },
    { id: 6, event: "contact_click", session_id: "orphan" },
    { id: 7, event: "cv_download" },
    { id: 8, event: "page_view" },
  ];
  const report = summarizeActivity(rows);
  assert.equal(report.views, 4);
  assert.equal(report.sessions.size, 3);
  assert.equal(report.eligibleSessions, 2);
  assert.equal(report.cvSessions, 1);
  assert.equal(report.contactSessions, 0);
  assert.equal(report.legacy, 2);
});

test("empty and legacy metadata stay usable without fabricated sessions", () => {
  const empty = summarizeActivity([]);
  assert.equal(empty.sessions.size, 0);
  assert.equal(empty.medianLoad, null);
  const legacy = summarizeActivity([{ event: "page_view", details: null }, { event: "paper_click", target: "A paper", details: "invalid" }]);
  assert.deepEqual(legacy.devices, [["Not recorded", 1]]);
  assert.deepEqual(legacy.channels, [["Direct / unknown", 1]]);
  assert.deepEqual(legacy.papers, [["A paper", 1]]);
  assert.equal(legacy.eligibleSessions, 0);
});

test("paper rankings and channels count their stated events", () => {
  const rows = [
    { event: "page_view", details: { utm_source: "linkedin", utm_medium: "social", utm_campaign: "paper" }, referrer_domain: "example.com" },
    { event: "paper_click", target: "paper-1", details: { label: "Paper One", topic: "Water" } },
    { event: "paper_click", target: "paper-1", details: { label: "Paper One", topic: "Water" } },
    { event: "cv_download", details: { label: "CV", topic: "Water" } },
  ];
  const report = summarizeActivity(rows);
  assert.deepEqual(report.papers, [["Paper One", 2]]);
  assert.deepEqual(report.topics, [["Water", 2]]);
  assert.deepEqual(report.channels, [["linkedin / social / paper", 1]]);
  assert.equal(channelFor({ referrer_domain: "search.example" }), "search.example");
});

test("channels preserve session entry referrer rather than later internal navigation", () => {
  const internal = "zhaowilliam.github.io";
  assert.equal(channelFor({ referrer_domain: internal, details: { entry_referrer: null } }), "Direct / unknown");
  assert.equal(channelFor({ referrer_domain: internal, details: { entry_referrer: "google.com" } }), "google.com");
  assert.equal(channelFor({ referrer_domain: "google.com", details: {} }), "google.com");
  assert.equal(channelFor({ referrer_domain: internal, details: { utm_source: "linkedin", entry_referrer: null } }), "linkedin");
});

test("paper rankings merge case-insensitive DOI targets across pages and choose an informative title", () => {
  const rows = [
    { event: "paper_click", path: "/", target: "10.1029/2025WR041406", details: { label: "WRR paper" } },
    { event: "paper_click", path: "/publications.html", target: "10.1029/2025wr041406", details: { label: "Observation-informed simulations of snow water equivalent" } },
    { event: "paper_click", target: "https://doi.org/10.1029/2025WR041406", details: {} },
  ];
  assert.deepEqual(summarizeActivity(rows).papers, [["Observation-informed simulations of snow water equivalent", 3]]);
  assert.deepEqual(summarizeActivity([...rows].reverse()).papers, summarizeActivity(rows).papers);
});

test("timing uses deltas and valid samples only", () => {
  const report = summarizeActivity([
    { event: "engagement", details: { seconds: 15 } },
    { event: "engagement", details: { seconds: 10 } },
    { event: "engagement", details: { seconds: -100 } },
    { event: "page_performance", details: { load_ms: 300 } },
    { event: "page_performance", details: { load_ms: 100 } },
    { event: "page_performance", details: { load_ms: "unknown" } },
  ]);
  assert.equal(report.foregroundSeconds, 25);
  assert.equal(report.medianLoad, 200);
  assert.equal(report.performanceSamples, 2);
});

test("problem groups show the sanitized failing resource when recorded", () => {
  const report = summarizeActivity([
    { event: "resource_error", path: "/", target: "script", details: { error_kind: "load", link_url: "/assets/example.js" } },
    { event: "resource_error", path: "/", target: "video", details: { error_kind: "load" } },
  ]);
  assert.ok(report.problems.some(([label, count]) => label === "load · / · /assets/example.js" && count === 1));
  assert.ok(report.problems.some(([label, count]) => label === "load · / · video" && count === 1));
});

test("activity dates use New York calendar date and daylight-saving offset", () => {
  assert.equal(formatDateTime("2026-09-16T02:05:06Z"), "2026-09-15 22:05:06 EDT");
  assert.equal(formatDateTime("2026-01-16T02:05:06Z"), "2026-01-15 21:05:06 EST");
  assert.equal(formatDateTime("nonsense"), "Unknown time");
});

test("session paths use cross-page browser sequence while global activity remains receipt-ordered", () => {
  const rows = [
    { id: 2, session_id: "s", timestamp_utc: "2026-09-16T12:00:02Z", details: { page_id: "p", sequence: 1 } },
    { id: 1, session_id: "s", timestamp_utc: "2026-09-16T12:00:00Z", details: { page_id: "p2", sequence: 2 } },
  ];
  assert.deepEqual(orderEvents(rows).map((row) => row.id), [1, 2]);
  assert.deepEqual(summarizeActivity(rows).sessions.get("s").map((row) => row.id), [2, 1]);
  assert.equal(rows[0].id, 2);
});

test("incomplete session sequences consistently fall back to receipt order", () => {
  const rows = [
    { id: 3, session_id: "s", timestamp_utc: "2026-09-16T12:00:02Z", details: { sequence: 1 } },
    { id: 1, session_id: "s", timestamp_utc: "2026-09-16T12:00:00Z", details: { sequence: 2 } },
    { id: 2, session_id: "s", timestamp_utc: "2026-09-16T12:00:01Z", details: {} },
  ];
  assert.deepEqual(summarizeActivity(rows).sessions.get("s").map((row) => row.id), [1, 2, 3]);
});

test("untrusted labels stay text and private storage is not persisted", () => {
  const malicious = '<img src=x onerror="alert(1)">';
  assert.deepEqual(summarizeActivity([{ event: "paper_click", details: { label: malicious } }]).papers, [[malicious, 1]]);
  const source = readFileSync(new URL("../assets/analytics-dashboard.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|document\.write/u);
  assert.match(source, /element\.textContent = String\(text\)/u);
  assert.match(source, /marker\.bindTooltip\(tooltip\)/u);
  assert.doesNotMatch(source, /(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:token|events)/u);
});
