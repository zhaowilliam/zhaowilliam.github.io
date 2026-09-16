import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import worker from '../analytics-worker/worker.mjs';

const origin = 'https://zhaowilliam.github.io';
const token = 'test-only-not-a-production-secret-123456789';
const eventId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../analytics-worker/schema.sql', import.meta.url), 'utf8'));
  db.exec("INSERT INTO events(event,path,visitor_hash,ip,occurred_at) VALUES('page_view','/','old','192.0.2.1',datetime('now','-31 days'))");
  db.exec(readFileSync(new URL('../analytics-worker/migrations/0001_interaction_details.sql', import.meta.url), 'utf8'));
  const env = {
    ALLOWED_ORIGIN: origin, HASH_SECRET: token, ADMIN_TOKEN: token,
    RATE_LIMITER: { limit: async () => ({ success: true }) },
    DB: { prepare(sql) {
      // Match D1's prepare/bind/all/run contract while exercising real SQLite.
      const statement = db.prepare(sql);
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async all() { return { results: statement.all(...values) }; },
        async run() { return statement.run(...values); },
      };
    } },
  };
  const collect = (body, headers = {}) => worker.fetch(new Request('https://analytics.example/collect', {
    method: 'POST', headers: { origin, 'content-type': 'text/plain', 'cf-connecting-ip': '192.0.2.2', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }), env);
  const get = (path, auth = token) => worker.fetch(new Request(`https://analytics.example${path}`, {
    headers: { origin, ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
  }), env);
  return { db, env, collect, get };
}

test('additive upgrade preserves history; old and new clients, deduplication, sanitized details', async () => {
  const { db, collect, get } = fixture();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 1);
  assert.equal((await collect({ event: 'page_view', path: '/', target: 'home' })).status, 204);
  const payload = { event: 'paper_click', path: '/', target: '10.5194/hess-30-5373-2026', event_id: eventId,
    session_id: sessionId, details: { label: 'Learning evaporative fraction', topic: 'water-energy',
      link_url: 'https://doi.org/10.5194/hess-30-5373-2026?email=secret#private', page_id: eventId, sequence: 2,
      device: 'desktop', viewport: 'large', browser: 'safari', utm_source: 'linkedin', entry_referrer: null } };
  assert.equal((await collect(payload)).status, 204);
  assert.equal((await collect(payload)).status, 204);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 3);
  const response = await get('/events.json?limit=1');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  const report = await response.json();
  assert.equal(report.events[0].details.link_url, 'https://doi.org/10.5194/hess-30-5373-2026');
  assert.equal(report.events[0].details.entry_referrer, null);
  assert.equal(report.events[0].session_id, sessionId);
  assert.equal(report.events[0].latitude, null);
  const next = await (await get(`/events.json?limit=1&before=${report.next_before}`)).json();
  assert.equal(next.events[0].event, 'page_view');
  assert.equal((await (await get('/events.json')).json()).events.length, 2);
  db.close();
});

test('private endpoints require token; origin, parameters, methods and preflight are constrained', async () => {
  const { db, env, get } = fixture();
  for (const path of ['/events.json', '/export.csv', '/locations.json']) {
    assert.equal((await get(path, '')).status, 401);
    assert.equal((await get(path, 'bad')).status, 401);
    assert.equal((await worker.fetch(new Request(`https://analytics.example${path}`, {
      headers: { origin: 'https://evil.example', authorization: `Bearer ${token}` },
    }), env)).status, 403);
  }
  assert.equal((await get('/events.json?days=31')).status, 400);
  assert.equal((await get('/events.json?before=no')).status, 400);
  const preflight = await worker.fetch(new Request('https://analytics.example/events.json', {
    method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
  }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'Authorization');
  assert.equal((await worker.fetch(new Request('https://analytics.example/events.json', { method: 'POST' }), env)).status, 405);
  db.close();
});

test('optouts write nothing, bad metadata is rejected, bounded body and rate limit', async () => {
  const { db, env, collect } = fixture();
  const base = { event: 'page_view', path: '/' };
  for (const headers of [{ 'sec-gpc': '1' }, { dnt: '1' }]) assert.equal((await collect(base, headers)).status, 204);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 1);
  for (const details of [[], { email: 'private@example.com' }, { seconds: -1 }, { seconds: 1.1 }, { device: 'unique-fingerprint' },
    { link_url: 'https://username:password@example.com/x' }, { link_url: 'javascript:alert(1)' },
    { utm_source: 'person@example.com' }, { percent: 101 }, { page_id: 'bad' }, { sequence: 0 }]) {
    assert.equal((await collect({ ...base, details })).status, 400, JSON.stringify(details));
  }
  assert.equal((await collect({ ...base, session_id: 'bad' })).status, 400);
  assert.equal((await collect({ ...base, path: '/?email=private' })).status, 400);
  assert.equal((await collect('x'.repeat(4097))).status, 413);
  assert.equal((await collect(base, { origin: 'https://evil.example' })).status, 403);
  env.RATE_LIMITER.limit = async () => ({ success: false });
  assert.equal((await collect(base)).status, 429);
  db.close();
});

test('CSV keeps new fields, escapes spreadsheet formulas, and masks expired IP/session before cleanup', async () => {
  const { db, env, collect, get } = fixture();
  await collect({ event: 'cv_download', path: '/', target: '=HYPERLINK("https://example.com")', event_id: eventId, session_id: sessionId });
  db.prepare('UPDATE events SET session_id=? WHERE id=1').run(sessionId);
  const csv = await (await get('/export.csv')).text();
  assert.match(csv, /event_id,session_id,details_json/);
  assert.match(csv, /'=HYPERLINK/);
  assert.ok(!csv.includes('192.0.2.1'));
  assert.equal(csv.split('\r\n').at(-1).includes(sessionId), false);
  await worker.scheduled({}, env);
  assert.equal(db.prepare('SELECT ip FROM events WHERE id=1').get().ip, null);
  assert.equal(db.prepare('SELECT session_id FROM events WHERE id=1').get().session_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 2);
  db.close();
});
