import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/app.js';
import { createStore } from '../src/store.js';

// ---------- helpers ----------
async function start(overrides = {}) {
  let tick = 0;
  const store = overrides.store ?? createStore({ now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString() });
  const server = createServer(createApp({ store, logger: () => {} }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, body, headers = {}) {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      init.headers['Content-Type'] ??= 'application/json';
    }
    const res = await fetch(base + path, init);
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : undefined; } catch { /* leave undefined */ }
    return { status: res.status, headers: res.headers, body: json, text };
  }
  return { call, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

async function withApi(t, overrides) {
  const api = await start(overrides);
  t.after(api.close);
  return api;
}

const book = (over = {}) => ({ title: 'The Example Atlas', author: 'A. Writer', ...over });

// Every error must have this exact shape and must never leak internals.
function assertError(res, status, code) {
  assert.equal(res.status, status);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.body.error.code, code);
  assert.equal(typeof res.body.error.message, 'string');
  assert.doesNotMatch(res.text, /\bat\s.+:\d+|node_modules|stack/i);
  return res.body.error;
}

// ---------- happy paths ----------
test('GET /health returns 200', async (t) => {
  const { call } = await withApi(t);
  const res = await call('GET', '/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { data: { status: 'ok' } });
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('POST /books creates a book: 201, Location header, defaults applied, text trimmed', async (t) => {
  const { call } = await withApi(t);
  const res = await call('POST', '/books', { title: '  The Example Atlas  ', author: 'A. Writer' });
  assert.equal(res.status, 201);
  const b = res.body.data;
  assert.match(b.id, /^[0-9a-f-]{36}$/);
  assert.equal(res.headers.get('location'), `/books/${b.id}`);
  assert.equal(b.title, 'The Example Atlas');
  assert.equal(b.status, 'to-read');
  assert.equal(b.rating, null);
  assert.equal(b.createdAt, b.updatedAt);
});

test('GET /books/:id returns the book', async (t) => {
  const { call } = await withApi(t);
  const { body } = await call('POST', '/books', book());
  const res = await call('GET', `/books/${body.data.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, body.data);
});

test('GET /books lists with filters and pagination', async (t) => {
  const { call } = await withApi(t);
  await call('POST', '/books', book({ title: 'Alpha', author: 'Zed Person' }));
  await call('POST', '/books', book({ title: 'Beta', author: 'Yan Person', status: 'reading' }));
  await call('POST', '/books', book({ title: 'Gamma', author: 'Xi Person', status: 'finished', rating: 5 }));
  await call('POST', '/books', book({ title: 'Delta', author: 'Wu Person' }));
  await call('POST', '/books', book({ title: 'Epsilon', author: 'Vee Person' }));

  const all = await call('GET', '/books');
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.meta, { total: 5, limit: 20, offset: 0 });
  assert.equal(all.body.data.length, 5);

  const page = await call('GET', '/books?limit=2&offset=2');
  assert.deepEqual(page.body.meta, { total: 5, limit: 2, offset: 2 });
  assert.deepEqual(page.body.data.map((b) => b.title), ['Gamma', 'Delta']);

  const reading = await call('GET', '/books?status=reading');
  assert.deepEqual(reading.body.data.map((b) => b.title), ['Beta']);

  const search = await call('GET', '/books?q=yAN');
  assert.deepEqual(search.body.data.map((b) => b.title), ['Beta']);

  const none = await call('GET', '/books?q=nothing-matches');
  assert.deepEqual(none.body, { data: [], meta: { total: 0, limit: 20, offset: 0 } });
});

test('PUT replaces the whole book (omitted rating resets to null)', async (t) => {
  const { call } = await withApi(t);
  const created = (await call('POST', '/books', book({ status: 'finished', rating: 5 }))).body.data;
  const res = await call('PUT', `/books/${created.id}`, { title: 'New Title', author: 'A. Writer', status: 'finished' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.title, 'New Title');
  assert.equal(res.body.data.rating, null);
  assert.equal(res.body.data.id, created.id);
  assert.equal(res.body.data.createdAt, created.createdAt);
  assert.notEqual(res.body.data.updatedAt, created.updatedAt);
});

test('PATCH changes only the fields sent', async (t) => {
  const { call } = await withApi(t);
  const created = (await call('POST', '/books', book({ status: 'finished', rating: 3 }))).body.data;
  const res = await call('PATCH', `/books/${created.id}`, { rating: 4 });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.rating, 4);
  assert.equal(res.body.data.title, created.title);
  const same = await call('PATCH', `/books/${created.id}`, { title: created.title });
  assert.equal(same.status, 200, 'sending your own values is not a conflict with yourself');
});

test('DELETE returns 204 with no body, then the book is gone', async (t) => {
  const { call } = await withApi(t);
  const { body } = await call('POST', '/books', book());
  const res = await call('DELETE', `/books/${body.data.id}`);
  assert.equal(res.status, 204);
  assert.equal(res.text, '');
  assertError(await call('GET', `/books/${body.data.id}`), 404, 'NOT_FOUND');
  assertError(await call('DELETE', `/books/${body.data.id}`), 404, 'NOT_FOUND');
});

// ---------- 422: bad input on create ----------
const badCreates = [
  ['missing title', { author: 'A' }, 'title'],
  ['missing author', { title: 'T' }, 'author'],
  ['title is a number', { title: 123, author: 'A' }, 'title'],
  ['title is null', { title: null, author: 'A' }, 'title'],
  ['title is an object', { title: {}, author: 'A' }, 'title'],
  ['title is blank', { title: '   ', author: 'A' }, 'title'],
  ['title too long', { title: 'x'.repeat(201), author: 'A' }, 'title'],
  ['author too long', { title: 'T', author: 'x'.repeat(101) }, 'author'],
  ['control character in title', { title: 'bad\u0007title', author: 'A' }, 'title'],
  ['invalid status', { title: 'T', author: 'A', status: 'maybe' }, 'status'],
  ['null status', { title: 'T', author: 'A', status: null }, 'status'],
  ['rating too high', { title: 'T', author: 'A', status: 'finished', rating: 6 }, 'rating'],
  ['rating zero', { title: 'T', author: 'A', status: 'finished', rating: 0 }, 'rating'],
  ['rating not an integer', { title: 'T', author: 'A', status: 'finished', rating: 3.5 }, 'rating'],
  ['rating is a string', { title: 'T', author: 'A', status: 'finished', rating: '4' }, 'rating'],
  ['rating on an unfinished book', { title: 'T', author: 'A', status: 'reading', rating: 4 }, 'rating'],
  ['rating on a default (to-read) book', { title: 'T', author: 'A', rating: 4 }, 'rating'],
  ['unknown field', { title: 'T', author: 'A', colour: 'red' }, 'colour'],
  ['client tries to set id', { title: 'T', author: 'A', id: 'abc' }, 'id'],
  ['client tries to set createdAt', { title: 'T', author: 'A', createdAt: '2020-01-01' }, 'createdAt'],
];
for (const [name, body, field] of badCreates) {
  test(`POST rejects with 422: ${name}`, async (t) => {
    const { call } = await withApi(t);
    const err = assertError(await call('POST', '/books', body), 422, 'VALIDATION_ERROR');
    assert.ok(err.details.some((d) => d.field === field), `expected a detail for "${field}"`);
    assert.equal((await call('GET', '/books')).body.meta.total, 0, 'nothing was stored');
  });
}

test('POST reports every problem at once', async (t) => {
  const { call } = await withApi(t);
  const err = assertError(await call('POST', '/books', { title: '', status: 'nope', extra: 1 }), 422, 'VALIDATION_ERROR');
  assert.deepEqual(err.details.map((d) => d.field).sort(), ['author', 'extra', 'status', 'title']);
});

test('body that is not a JSON object is rejected with 422', async (t) => {
  const { call } = await withApi(t);
  for (const body of ['[]', 'null', '42', '"text"']) {
    const err = assertError(await call('POST', '/books', body), 422, 'VALIDATION_ERROR');
    assert.equal(err.details[0].field, 'body');
  }
});

// ---------- 400 / 413 / 415: bad requests ----------
test('malformed JSON gives 400 INVALID_JSON and does not echo the input', async (t) => {
  const { call } = await withApi(t);
  const res = await call('POST', '/books', '{"title": "oops",');
  assertError(res, 400, 'INVALID_JSON');
  assert.doesNotMatch(res.text, /oops/);
});

test('empty body gives 400 INVALID_JSON', async (t) => {
  const { call } = await withApi(t);
  assertError(await call('POST', '/books', '', { 'Content-Type': 'application/json' }), 400, 'INVALID_JSON');
});

test('wrong Content-Type gives 415', async (t) => {
  const { call } = await withApi(t);
  assertError(await call('POST', '/books', JSON.stringify(book()), { 'Content-Type': 'text/plain' }), 415, 'UNSUPPORTED_MEDIA_TYPE');
});

test('Content-Type with a charset is accepted', async (t) => {
  const { call } = await withApi(t);
  const res = await call('POST', '/books', JSON.stringify(book()), { 'Content-Type': 'application/json; charset=utf-8' });
  assert.equal(res.status, 201);
});

test('oversized body gives 413 and does not echo it', async (t) => {
  const { call } = await withApi(t);
  const res = await call('POST', '/books', { title: 'x'.repeat(20_000), author: 'A' });
  assertError(res, 413, 'PAYLOAD_TOO_LARGE');
  assert.ok(res.text.length < 300);
});

test('invalid query parameters give 400 INVALID_QUERY', async (t) => {
  const { call } = await withApi(t);
  const cases = [['limit=0', 'limit'], ['limit=101', 'limit'], ['limit=abc', 'limit'], ['limit=-1', 'limit'],
    ['offset=-1', 'offset'], ['offset=1.5', 'offset'], ['status=bad', 'status'], [`q=${'x'.repeat(101)}`, 'q']];
  for (const [qs, field] of cases) {
    const err = assertError(await call('GET', `/books?${qs}`), 400, 'INVALID_QUERY');
    assert.ok(err.details.some((d) => d.field === field), qs);
  }
});

// ---------- PUT / PATCH validation ----------
test('PUT requires every field except rating', async (t) => {
  const { call } = await withApi(t);
  const created = (await call('POST', '/books', book())).body.data;
  const err = assertError(await call('PUT', `/books/${created.id}`, { title: 'T', author: 'A' }), 422, 'VALIDATION_ERROR');
  assert.deepEqual(err.details.map((d) => d.field), ['status']);
});

test('PATCH with an empty object gives 422', async (t) => {
  const { call } = await withApi(t);
  const created = (await call('POST', '/books', book())).body.data;
  const err = assertError(await call('PATCH', `/books/${created.id}`, {}), 422, 'VALIDATION_ERROR');
  assert.equal(err.details[0].field, 'body');
});

test('PATCH that would leave a rating on an unfinished book is rejected and changes nothing', async (t) => {
  const { call } = await withApi(t);
  const created = (await call('POST', '/books', book({ status: 'finished', rating: 4 }))).body.data;
  assertError(await call('PATCH', `/books/${created.id}`, { status: 'reading' }), 422, 'VALIDATION_ERROR');
  const after = (await call('GET', `/books/${created.id}`)).body.data;
  assert.equal(after.status, 'finished');
  const ok = await call('PATCH', `/books/${created.id}`, { status: 'reading', rating: null });
  assert.equal(ok.status, 200);
});

test('PATCH rejects unknown fields and bad values', async (t) => {
  const { call } = await withApi(t);
  const created = (await call('POST', '/books', book())).body.data;
  assertError(await call('PATCH', `/books/${created.id}`, { id: 'x' }), 422, 'VALIDATION_ERROR');
  assertError(await call('PATCH', `/books/${created.id}`, { title: 5 }), 422, 'VALIDATION_ERROR');
});

// ---------- 409 conflicts ----------
test('duplicate title+author gives 409 (case and spacing ignored) on POST, PUT and PATCH', async (t) => {
  const { call } = await withApi(t);
  await call('POST', '/books', book());
  assertError(await call('POST', '/books', { title: '  the example ATLAS ', author: 'a. writer' }), 409, 'CONFLICT');

  const other = (await call('POST', '/books', book({ title: 'Other' }))).body.data;
  assertError(await call('PATCH', `/books/${other.id}`, { title: 'The Example Atlas' }), 409, 'CONFLICT');
  assertError(await call('PUT', `/books/${other.id}`, { title: 'The Example Atlas', author: 'A. Writer', status: 'to-read' }), 409, 'CONFLICT');
});

// ---------- 404 / 405 ----------
test('unknown ids give 404 for GET, PUT, PATCH and DELETE', async (t) => {
  const { call } = await withApi(t);
  const missing = '/books/123e4567-e89b-42d3-a456-426614174000';
  assertError(await call('GET', missing), 404, 'NOT_FOUND');
  assertError(await call('PUT', missing, { title: 'T', author: 'A', status: 'to-read' }), 404, 'NOT_FOUND');
  assertError(await call('PATCH', missing, { title: 'T' }), 404, 'NOT_FOUND');
  assertError(await call('DELETE', missing), 404, 'NOT_FOUND');
});

test('malformed ids give the same 404 and are not echoed', async (t) => {
  const { call } = await withApi(t);
  const res = await call('GET', '/books/not-a-real-id');
  assertError(res, 404, 'NOT_FOUND');
  assert.doesNotMatch(res.text, /not-a-real-id/);
});

test('unknown routes give 404', async (t) => {
  const { call } = await withApi(t);
  assertError(await call('GET', '/nope'), 404, 'NOT_FOUND');
  assertError(await call('GET', '/books/a/b'), 404, 'NOT_FOUND');
});

test('wrong method on a known path gives 405 with an Allow header', async (t) => {
  const { call } = await withApi(t);
  const a = await call('DELETE', '/books');
  assertError(a, 405, 'METHOD_NOT_ALLOWED');
  assert.equal(a.headers.get('allow'), 'GET, POST');
  const b = await call('POST', '/books/123e4567-e89b-42d3-a456-426614174000', book());
  assertError(b, 405, 'METHOD_NOT_ALLOWED');
  assert.equal(b.headers.get('allow'), 'GET, PUT, PATCH, DELETE');
  assertError(await call('POST', '/health', {}), 405, 'METHOD_NOT_ALLOWED');
});

// ---------- 500 ----------
test('unexpected failure gives a generic 500 with no internals', async (t) => {
  const store = createStore();
  store.list = () => { throw new TypeError('db exploded at /srv/secret/db.js:42:7'); };
  const { call } = await withApi(t, { store });
  const res = await call('GET', '/books');
  assertError(res, 500, 'INTERNAL_ERROR');
  assert.doesNotMatch(res.text, /exploded|secret|db\.js|TypeError/);
});

test('the server keeps working after an error', async (t) => {
  const { call } = await withApi(t);
  await call('POST', '/books', '{bad');
  assert.equal((await call('GET', '/health')).status, 200);
});
