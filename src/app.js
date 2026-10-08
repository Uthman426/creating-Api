import { ApiError } from './errors.js';
import { STATUSES, KNOWN_FIELDS, validateBook, unknownFieldErrors } from './validate.js';

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 10_000;       // larger bodies get 413
const HARD_LIMIT_BYTES = 1_000_000;  // beyond this we drop the connection

const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };

function send(res, status, payload, headers = {}) {
  if (status === 204) {
    res.writeHead(204, { ...SECURITY_HEADERS, ...headers });
    return res.end();
  }
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...SECURITY_HEADERS,
    ...headers,
  });
  res.end(body);
}

function allow(req, methods) {
  if (!methods.includes(req.method)) {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', `${String(req.method).slice(0, 20)} is not allowed on this path.`, {
      headers: { Allow: methods.join(', ') },
    });
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) {
      req.resume();
      return reject(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the body as JSON with the header "Content-Type: application/json".'));
    }
    let size = 0;
    let tooBig = false;
    let done = false;
    const chunks = [];
    const fail = (err) => { if (!done) { done = true; reject(err); } };
    const tooLarge = () => new ApiError(413, 'PAYLOAD_TOO_LARGE', `The request body must be at most ${MAX_BODY_BYTES} bytes.`);

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > HARD_LIMIT_BYTES) return req.destroy();
      if (size <= MAX_BODY_BYTES) chunks.push(chunk); else tooBig = true; // keep draining, stop buffering
    });
    req.on('end', () => {
      if (done) return;
      if (tooBig) return fail(tooLarge());
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') return fail(new ApiError(400, 'INVALID_JSON', 'The request body must not be empty.'));
      try {
        done = true;
        resolve(JSON.parse(text));
      } catch {
        done = false;
        fail(new ApiError(400, 'INVALID_JSON', 'The request body is not valid JSON.'));
      }
    });
    req.on('error', () => fail(new ApiError(400, 'INVALID_JSON', 'The request could not be read.')));
    req.on('close', () => fail(tooLarge()));
  });
}

function requireObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'The request body failed validation.', {
      details: [{ field: 'body', message: 'body must be a JSON object' }],
    });
  }
  return body;
}

function validationFailure(errors) {
  return new ApiError(422, 'VALIDATION_ERROR', 'The request body failed validation.', { details: errors });
}

function parseListQuery(params) {
  const errors = [];
  const out = { status: undefined, q: undefined, limit: 20, offset: 0 };
  if (params.has('status')) {
    const v = params.get('status');
    if (STATUSES.includes(v)) out.status = v;
    else errors.push({ field: 'status', message: `status must be one of: ${STATUSES.join(', ')}` });
  }
  if (params.has('q')) {
    const v = params.get('q').trim();
    if (v.length > 100) errors.push({ field: 'q', message: 'q must be at most 100 characters' });
    else if (v) out.q = v.toLowerCase();
  }
  if (params.has('limit')) {
    const v = params.get('limit');
    if (/^\d{1,9}$/.test(v) && +v >= 1 && +v <= 100) out.limit = +v;
    else errors.push({ field: 'limit', message: 'limit must be a whole number from 1 to 100' });
  }
  if (params.has('offset')) {
    const v = params.get('offset');
    if (/^\d{1,9}$/.test(v)) out.offset = +v;
    else errors.push({ field: 'offset', message: 'offset must be a whole number of 0 or more' });
  }
  if (errors.length) throw new ApiError(400, 'INVALID_QUERY', 'One or more query parameters are invalid.', { details: errors });
  return out;
}

export function createApp({ store, logger = (err) => console.error(err) }) {
  const notFound = () => new ApiError(404, 'NOT_FOUND', 'No book exists with that id.');
  const pick = (b) => ({ title: b.title, author: b.author, status: b.status, rating: b.rating });

  function assertNoDuplicate(value, exceptId) {
    if (store.findDuplicate(value.title, value.author, exceptId)) {
      throw new ApiError(409, 'CONFLICT', 'A book with the same title and author already exists.');
    }
  }

  async function route(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      throw new ApiError(400, 'BAD_REQUEST', 'The request URL is malformed.');
    }
    const path = url.pathname;

    if (path === '/health') {
      allow(req, ['GET']);
      return send(res, 200, { data: { status: 'ok' } });
    }

    if (path === '/books') {
      allow(req, ['GET', 'POST']);
      if (req.method === 'GET') {
        const query = parseListQuery(url.searchParams);
        const { total, items } = store.list(query);
        return send(res, 200, { data: items, meta: { total, limit: query.limit, offset: query.offset } });
      }
      const input = requireObject(await readJson(req));
      const candidate = {
        title: input.title,
        author: input.author,
        status: Object.hasOwn(input, 'status') ? input.status : 'to-read',
        rating: input.rating,
      };
      const { errors, value } = validateBook(candidate);
      const all = [...unknownFieldErrors(input), ...errors];
      if (all.length) throw validationFailure(all);
      assertNoDuplicate(value);
      const book = store.create(value);
      return send(res, 201, { data: book }, { Location: `/books/${book.id}` });
    }

    const match = /^\/books\/([^/]+)$/.exec(path);
    if (match) {
      allow(req, ['GET', 'PUT', 'PATCH', 'DELETE']);
      const id = match[1];
      const known = ID_PATTERN.test(id);

      if (req.method === 'GET') {
        const book = known && store.get(id);
        if (!book) throw notFound();
        return send(res, 200, { data: book });
      }
      if (req.method === 'DELETE') {
        if (!known || !store.remove(id)) throw notFound();
        return send(res, 204);
      }

      // PUT and PATCH: read and parse the body, then look the book up, then validate.
      const input = requireObject(await readJson(req));
      const existing = known && store.get(id);
      if (!existing) throw notFound();

      let candidate;
      if (req.method === 'PUT') {
        candidate = { title: input.title, author: input.author, status: input.status, rating: input.rating };
      } else {
        if (Object.keys(input).length === 0) {
          throw validationFailure([{ field: 'body', message: `provide at least one of: ${KNOWN_FIELDS.join(', ')}` }]);
        }
        candidate = { ...pick(existing), ...input };
      }
      const { errors, value } = validateBook(candidate);
      const all = [...unknownFieldErrors(input), ...errors];
      if (all.length) throw validationFailure(all);
      assertNoDuplicate(value, id);
      return send(res, 200, { data: store.replace(id, value) });
    }

    throw new ApiError(404, 'NOT_FOUND', 'No such route.');
  }

  return async function handler(req, res) {
    try {
      await route(req, res);
    } catch (err) {
      if (res.headersSent) return res.end();
      if (err instanceof ApiError) {
        const error = { code: err.code, message: err.message };
        if (err.details) error.details = err.details;
        return send(res, err.status, { error }, err.headers);
      }
      logger(err);
      send(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.' } });
    }
  };
}
