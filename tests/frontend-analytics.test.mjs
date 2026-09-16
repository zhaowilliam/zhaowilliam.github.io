import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../assets/site.js", import.meta.url), "utf8");

class Surface {
  listeners = new Map();
  dataset = {};
  addEventListener(type, callback, options = {}) {
    this.listeners.set(type, [...this.listeners.get(type) || [], { callback, once: options.once }]);
  }
  emit(type, properties = {}) {
    const event = { type, target: this, ...properties };
    for (const entry of [...this.listeners.get(type) || []]) {
      if (entry.once) this.listeners.set(type, this.listeners.get(type).filter((item) => item !== entry));
      entry.callback(event);
    }
  }
}

function run(options = {}) {
  const document = new Surface();
  const window = new Surface();
  const launch = new Surface();
  const teaser = new Surface();
  const frame = { replaceChildren(element) { this.child = element; } };
  const counters = [];
  const requests = [];
  const beaconBodies = [];
  const observers = [];
  const stored = options.stored || new Map();
  let now = options.now || 1_000_000;
  let localReads = 0;
  let sessionReads = 0;
  let sessionWrites = 0;
  let nextTimer = 0;
  const timers = new Map();
  window.location = new URL(options.url || "https://zhaowilliam.github.io/");
  window.innerWidth = 1200;
  window.innerHeight = 800;
  window.scrollY = 0;
  document.referrer = options.referrer ?? "https://www.linkedin.com/feed/?private=secret";
  document.body = { dataset: { analyticsPage: "home" } };
  document.documentElement = { scrollHeight: 4000 };
  document.readyState = "loading";
  document.visibilityState = "visible";
  document.querySelector = (selector) => ({
    'meta[name="analytics-endpoint"]': { content: "https://example.test" },
    "#hess-video-launch": launch,
    "#hess-video-frame": frame,
    "#ef-memory-teaser": teaser,
  })[selector];
  document.querySelectorAll = () => options.sections || [];
  document.createElement = () => new Surface();
  teaser.duration = 14;
  teaser.played = { length: 0 };
  const navigator = {
    userAgent: "Mozilla/5.0 Chrome/120.0 Safari/537.36",
    ...options.navigator,
    sendBeacon: (_url, body) => {
      if (options.beaconThrows) throw new Error("Blocked");
      beaconBodies.push(body);
      return true;
    },
  };
  const context = {
    window, document, navigator, URL, URLSearchParams, Blob, crypto: { randomUUID },
    Date: class extends Date { static now() { return now; } },
    performance: { now: () => now, getEntriesByType: () => [{ loadEventEnd: 123.4 }] },
    Image: class { set src(value) { counters.push(value); } },
    localStorage: { getItem() { localReads += 1; if (options.storageThrows) throw new Error("Storage denied"); return options.disabled ? "1" : null; } },
    sessionStorage: {
      getItem(key) { sessionReads += 1; if (options.storageThrows) throw new Error("Storage denied"); return stored.get(key) || null; },
      setItem(key, value) { sessionWrites += 1; if (options.storageThrows) throw new Error("Storage denied"); stored.set(key, value); },
    },
    fetch: (url, config) => { requests.push({ url, ...config }); if (options.fetchThrows) throw new Error("Network denied"); return Promise.resolve(); },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  if (options.sections) {
    context.IntersectionObserver = class {
      constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
      observe(target) { this.targets.push(target); }
    };
    window.IntersectionObserver = context.IntersectionObserver;
  }
  vm.runInNewContext(source, context);
  return {
    window, document, launch, teaser, frame, counters, requests, stored, timers, observers,
    advance: (ms) => { now += ms; },
    flush: () => { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } },
    reads: () => ({ localReads, sessionReads, sessionWrites }),
    events: async () => [
      ...await Promise.all(beaconBodies.map(async (body) => JSON.parse(await body.text()))),
      ...requests.map((request) => JSON.parse(request.body)),
    ],
  };
}

function link(href, dataset = {}, textContent = "Read paper", title = "Learning evaporative fraction with memory") {
  const element = {
    href, dataset, textContent,
    getAttribute: () => null,
    closest: (selector) => {
      if (selector === "a[href]") return element;
      if (selector === "article, li") return { querySelector: () => ({ textContent: title }) };
      if (selector === "section") return { id: "publications" };
      return null;
    },
  };
  return element;
}

test("opt-outs and admin/local preview do no tracking or session-storage work; video still opens", async () => {
  for (const options of [
    { navigator: { globalPrivacyControl: true } },
    { navigator: { doNotTrack: "1" } },
    { url: "http://localhost:8000/" },
    { url: "https://zhaowilliam.github.io/analytics.html" },
    { disabled: true },
  ]) {
    const page = run(options);
    page.launch.emit("click");
    page.document.emit("click", { button: 0, target: link("https://doi.org/10.5194/hess-30-5373-2026") });
    assert.equal(page.frame.child.src, "https://av.tib.eu/player/73776");
    assert.deepEqual(await page.events(), []);
    assert.deepEqual(page.counters, []);
    assert.equal(page.reads().sessionReads, 0);
    assert.equal(page.reads().sessionWrites, 0);
    if (!options.disabled) assert.equal(page.reads().localReads, 0);
  }
});

test("beacon and storage failures fall back without breaking CV navigation or video controls", async () => {
  const page = run({ beaconThrows: true, storageThrows: true, fetchThrows: true });
  let prevented = false;
  page.document.emit("click", { button: 0, target: link("https://zhaowilliam.github.io/assets/documents/Wenli_Zhao_CV.pdf", { analyticsEvent: "cv_download", analyticsTarget: "hero" }, "Download CV"), preventDefault() { prevented = true; } });
  page.launch.emit("click");
  assert.equal(prevented, false);
  assert.equal(page.frame.child.src, "https://av.tib.eu/player/73776");
  assert.equal((await page.events()).find((event) => event.event === "cv_download").target, "hero");
  assert.ok(page.requests.every((request) => request.keepalive && request.credentials === "omit"));
});

test("delegated primary/middle clicks classify destinations without URL query, hash, email or referrer secrets", async () => {
  const page = run({ url: "https://zhaowilliam.github.io/?utm_source=linkedin&utm_medium=social&utm_campaign=Fall_2026&email=secret" });
  page.document.emit("auxclick", { button: 1, target: link("https://doi.org/10.5194/hess-30-5373-2026?secret=1#private") });
  page.document.emit("click", { button: 0, target: link("https://doi.org/10.5446/73776", { analyticsEvent: "video_doi_click", analyticsTarget: "home-video-card" }) });
  page.document.emit("click", { button: 0, target: link("mailto:private@example.org?subject=secret", {}, "private@example.org") });
  page.document.emit("click", { button: 0, target: link("https://scholar.google.com/citations?user=secret#private", {}, "https://scholar.google.com/citations?user=secret#private") });
  page.document.emit("auxclick", { button: 2, target: link("https://example.org/") });
  const events = await page.events();
  const paper = events.find((event) => event.event === "paper_click");
  assert.equal(paper.target, "10.5194/hess-30-5373-2026");
  assert.equal(paper.details.topic, "water-cycle");
  assert.equal(paper.details.label, "Learning evaporative fraction with memory");
  assert.equal(paper.details.placement, "publications");
  assert.equal(events.length, 5);
  assert.equal(events.find((event) => event.event === "contact_click").details.link_url, "mailto");
  assert.ok(events.every((event) => event.details.utm_source === "linkedin" && event.referrer_domain === "www.linkedin.com"));
  assert.doesNotMatch(JSON.stringify(events), /secret|private@example|#private/u);
  assert.ok(events.every((event) => new Blob([JSON.stringify(event)]).size <= 4096));
});

test("untagged same-origin CV links are still CV events, with placement preserved", async () => {
  const page = run({ url: "https://zhaowilliam.github.io/publications.html" });
  const cv = link("https://zhaowilliam.github.io/assets/documents/Wenli_Zhao_CV.pdf?version=secret", {}, "CV");
  const previousClosest = cv.closest;
  cv.closest = (selector) => selector === "header" ? {} : previousClosest(selector);
  page.document.emit("click", { button: 0, target: cv });
  const event = (await page.events()).at(-1);
  assert.equal(event.event, "cv_download");
  assert.equal(event.target, "header");
  assert.equal(event.details.link_url, "https://zhaowilliam.github.io/assets/documents/Wenli_Zhao_CV.pdf");
});

test("session survives internal navigation, expires on inactivity and absolute age, and campaign identifiers are bounded", async () => {
  const page = run({ url: "https://zhaowilliam.github.io/?utm_source=linkedin&utm_campaign=person%40example.com" });
  const initial = (await page.events())[0];
  assert.equal(initial.details.utm_campaign, undefined);
  const next = run({ stored: page.stored, now: 1_001_000, url: "https://zhaowilliam.github.io/publications.html" });
  const second = (await next.events())[0];
  assert.equal(initial.session_id, second.session_id);
  assert.notEqual(initial.details.page_id, second.details.page_id);
  assert.equal(second.details.sequence, 2);
  assert.equal(second.details.utm_source, "linkedin");
  next.advance(30 * 60 * 1000);
  next.document.emit("click", { button: 0, target: link("https://example.org/") });
  assert.notEqual((await next.events()).at(-1).session_id, initial.session_id);
  const old = JSON.parse(page.stored.get("wenli.analytics.session"));
  old.created = 1;
  old.last = 30_000_000;
  page.stored.set("wenli.analytics.session", JSON.stringify(old));
  const late = run({ stored: page.stored, now: 30_000_001 });
  assert.notEqual((await late.events())[0].session_id, old.id);
});

test("entry referral survives internal navigation while raw page referrer remains accurate", async () => {
  const first = run();
  const initial = (await first.events())[0];
  const next = run({ stored: first.stored, now: 1_001_000, url: "https://zhaowilliam.github.io/publications.html", referrer: "https://zhaowilliam.github.io/?secret=1" });
  const second = (await next.events())[0];
  assert.equal(initial.details.entry_referrer, "www.linkedin.com");
  assert.equal(second.details.entry_referrer, "www.linkedin.com");
  assert.equal(second.referrer_domain, "zhaowilliam.github.io");
  assert.equal(second.session_id, initial.session_id);
  for (const referrer of ["", "https://zhaowilliam.github.io/index.html"]) {
    const page = run({ referrer });
    const event = (await page.events())[0];
    assert.equal(event.details.entry_referrer, null);
    assert.ok(Object.hasOwn(event.details, "entry_referrer"));
  }
});

test("restored non-v4 session identifiers are replaced", async () => {
  const page = run();
  const session = JSON.parse(page.stored.get("wenli.analytics.session"));
  session.id = "12345678-1234-1234-1234-123456789abc";
  page.stored.set("wenli.analytics.session", JSON.stringify(session));
  const next = run({ stored: page.stored, now: 1_001_000 });
  const event = (await next.events())[0];
  assert.notEqual(event.session_id, session.id);
  assert.match(event.session_id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu);
});

test("visible-time deltas never count hidden time or double count visibilitychange plus pagehide", async () => {
  const page = run();
  page.advance(12_000);
  page.document.visibilityState = "hidden";
  page.document.emit("visibilitychange");
  page.window.emit("pagehide");
  page.advance(60_000);
  page.document.visibilityState = "visible";
  page.document.emit("visibilitychange");
  page.advance(5000);
  page.window.emit("pagehide");
  const deltas = (await page.events()).filter((event) => event.event === "engagement");
  assert.deepEqual(deltas.map((event) => event.details.seconds), [12, 5]);
});

test("teaser progress counts played ranges rather than seek position and emits each milestone once", async () => {
  const page = run();
  page.teaser.currentTime = 14;
  page.teaser.emit("timeupdate");
  assert.equal((await page.events()).filter((event) => event.event === "video_progress").length, 0);
  page.teaser.played = { length: 1, start: () => 0, end: () => 7 };
  page.teaser.emit("timeupdate");
  page.teaser.emit("timeupdate");
  page.teaser.played.end = () => 14;
  page.teaser.emit("ended");
  assert.deepEqual((await page.events()).filter((event) => event.event === "video_progress").map((event) => event.details.percent), [25, 50, 75, 100]);
});

test("scroll, performance and resource errors are bounded and sanitize diagnostics", async () => {
  const page = run();
  page.window.scrollY = 3000;
  page.window.emit("scroll");
  page.window.emit("scroll");
  page.flush();
  page.window.emit("scroll");
  page.flush();
  page.window.emit("load");
  page.flush();
  for (const name of ["one", "one", "two", "three", "four"]) page.window.emit("error", { target: { tagName: "IMG", src: `https://example.org/${name}.png?token=secret#private` } });
  const events = await page.events();
  assert.deepEqual(events.filter((event) => event.event === "scroll_depth").map((event) => event.details.percent), [25, 50, 75, 90]);
  assert.equal(events.filter((event) => event.event === "resource_error").length, 3);
  assert.equal(events.find((event) => event.event === "page_performance").details.load_ms, 123);
  assert.doesNotMatch(JSON.stringify(events), /secret|#private/u);
});

test("section headings need continuous visibility; hidden tabs cancel pending exposure; exposure fires once", async () => {
  const heading = new Surface();
  const section = { id: "research", querySelector: () => heading };
  const page = run({ sections: [section] });
  const observer = page.observers[0];
  assert.equal(observer.targets[0], heading);
  const visible = { target: heading, isIntersecting: true, intersectionRatio: 0.6 };
  observer.callback([visible]);
  assert.equal([...page.timers.values()][0].delay, 1000);
  page.document.visibilityState = "hidden";
  page.document.emit("visibilitychange");
  page.flush();
  assert.equal((await page.events()).filter((event) => event.event === "section_view").length, 0);
  page.document.visibilityState = "visible";
  page.document.emit("visibilitychange");
  observer.callback([{ ...visible, isIntersecting: false, intersectionRatio: 0 }]);
  page.flush();
  assert.equal((await page.events()).filter((event) => event.event === "section_view").length, 0);
  observer.callback([visible]);
  page.advance(1000);
  page.flush();
  observer.callback([visible]);
  page.flush();
  assert.deepEqual((await page.events()).filter((event) => event.event === "section_view").map((event) => event.target), ["research"]);
});

test("runtime diagnostics never send exception messages or invent a resource URL", async () => {
  const page = run();
  page.window.emit("error", { message: "private form content", error: new Error("secret stack") });
  const error = (await page.events()).find((event) => event.event === "resource_error");
  assert.equal(error.details.error_kind, "script");
  assert.equal(error.details.link_url, undefined);
  assert.doesNotMatch(JSON.stringify(error), /private|secret|undefined/u);
});
