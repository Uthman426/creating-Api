# Reading List API

A small REST API for a reading list. It is built to be easy to run, easy to read, and strict about bad input.

- **Plain Node.js, no dependencies.** Nothing to install except Node 18 or newer.
- **In-memory data only.** Everything vanishes when the server stops.
- **Six endpoints**: create, read (list and one), replace, update and delete a book, plus a health check.
- **One error format** for every failure, with a stable `code` you can program against.
- **46 tests** that run with one command.
- **OpenAPI spec** in [`openapi.yaml`](openapi.yaml).

> **Privacy:** this API stores no personal data. A book has a title, an author, a reading status and an optional 1-5 rating. There are no accounts, no emails and no names of users. The sample data is fictional. Please do not put real personal information in the fields.

## Run it in five minutes

You need [Node.js](https://nodejs.org) 18 or newer (`node --version` to check).

```bash
git clone <your-repo-url> reading-list-api
cd reading-list-api

npm test          # runs all 46 tests, takes about a second
npm run demo      # starts the API with 3 fictional sample books
```

The server listens on `http://127.0.0.1:3000` (change it with `PORT=4000 npm run demo`). In a second terminal:

```bash
curl http://127.0.0.1:3000/books
```

`npm start` starts it empty instead of with sample books.

## Endpoints

| Method | Path | What it does | Success |
|---|---|---|---|
| GET | `/health` | Check the API is running | 200 |
| GET | `/books` | List books (filter and paginate) | 200 |
| POST | `/books` | Add a book | 201 |
| GET | `/books/{id}` | Get one book | 200 |
| PUT | `/books/{id}` | Replace a book (send all fields) | 200 |
| PATCH | `/books/{id}` | Change some fields | 200 |
| DELETE | `/books/{id}` | Delete a book | 204 |

List query parameters: `status` (`to-read`, `reading` or `finished`), `q` (text to find in the title or author), `limit` (1-100, default 20) and `offset` (default 0).

### A book

| Field | Rules |
|---|---|
| `id` | Set by the server (UUID). Read-only. |
| `title` | Required. Text, 1-200 characters after trimming spaces. No control characters. |
| `author` | Required. Text, 1-100 characters after trimming spaces. No control characters. |
| `status` | `to-read`, `reading` or `finished`. Defaults to `to-read` on create. Required for PUT. |
| `rating` | Whole number 1-5 or `null`. Only allowed when `status` is `finished`. |
| `createdAt`, `updatedAt` | Set by the server (ISO 8601). Read-only. |

Other rules:
- Unknown fields are rejected (this catches typos and stops clients setting `id` or `createdAt`).
- A second book with the same title and author (ignoring upper/lower case and surrounding spaces) is rejected.
- Request bodies must be JSON and at most 10,000 bytes.

## Example requests and responses

These are real outputs from running the server. Your `id` and timestamps will differ.

**Create a book**

```bash
curl -i -X POST http://127.0.0.1:3000/books \
  -H 'Content-Type: application/json' \
  -d '{"title":"The Example Atlas","author":"A. Writer"}'
```
```
HTTP/1.1 201 Created
Location: /books/700fccaa-72cd-4023-8d30-4e9601cc9101
```
```json
{
  "data": {
    "id": "700fccaa-72cd-4023-8d30-4e9601cc9101",
    "title": "The Example Atlas",
    "author": "A. Writer",
    "status": "to-read",
    "rating": null,
    "createdAt": "2026-10-08T20:04:17.954Z",
    "updatedAt": "2026-10-08T20:04:17.954Z"
  }
}
```

**Get one book**

```bash
curl http://127.0.0.1:3000/books/700fccaa-72cd-4023-8d30-4e9601cc9101
```
Returns `200` with the same `{ "data": { ... } }` shape as above.

**Update some fields (PATCH)**

```bash
curl -X PATCH http://127.0.0.1:3000/books/700fccaa-72cd-4023-8d30-4e9601cc9101 \
  -H 'Content-Type: application/json' \
  -d '{"status":"finished","rating":4}'
```
Returns `200`. `status` is now `"finished"`, `rating` is `4`, and `updatedAt` has changed.

**Replace a book (PUT)**

```bash
curl -X PUT http://127.0.0.1:3000/books/700fccaa-72cd-4023-8d30-4e9601cc9101 \
  -H 'Content-Type: application/json' \
  -d '{"title":"The Example Atlas","author":"A. Writer","status":"reading"}'
```
Returns `200`. Because PUT replaces the whole book and `rating` was left out, `rating` goes back to `null`.

**List with a filter**

```bash
curl 'http://127.0.0.1:3000/books?status=reading&limit=5'
```
```json
{
  "data": [
    {
      "id": "700fccaa-72cd-4023-8d30-4e9601cc9101",
      "title": "The Example Atlas",
      "author": "A. Writer",
      "status": "reading",
      "rating": null,
      "createdAt": "2026-10-08T20:04:17.954Z",
      "updatedAt": "2026-10-08T20:04:18.021Z"
    }
  ],
  "meta": { "total": 1, "limit": 5, "offset": 0 }
}
```

**Delete**

```bash
curl -i -X DELETE http://127.0.0.1:3000/books/700fccaa-72cd-4023-8d30-4e9601cc9101
```
```
HTTP/1.1 204 No Content
```

### Error examples

Every error has the same shape: `{ "error": { "code", "message", "details"? } }`. `details` appears when there are field-level problems, and lists **all** of them at once.

**422: valid JSON that breaks the rules**

```bash
curl -i -X POST http://127.0.0.1:3000/books \
  -H 'Content-Type: application/json' -d '{"title":"","status":"maybe"}'
```
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request body failed validation.",
    "details": [
      { "field": "title", "message": "title must not be empty" },
      { "field": "author", "message": "author is required" },
      { "field": "status", "message": "status must be one of: to-read, reading, finished" }
    ]
  }
}
```

**409: duplicate** (`POST` the same title and author again, in any letter case)
```json
{ "error": { "code": "CONFLICT", "message": "A book with the same title and author already exists." } }
```

**400: broken JSON** (`-d '{oops'`)
```json
{ "error": { "code": "INVALID_JSON", "message": "The request body is not valid JSON." } }
```

**415: wrong Content-Type** (`-H 'Content-Type: text/plain'`)
```json
{ "error": { "code": "UNSUPPORTED_MEDIA_TYPE", "message": "Send the body as JSON with the header \"Content-Type: application/json\"." } }
```

**404: unknown or malformed id** (`GET /books/not-a-real-id`)
```json
{ "error": { "code": "NOT_FOUND", "message": "No book exists with that id." } }
```

**405: wrong method** (`DELETE /books`). The response also has the header `Allow: GET, POST`.
```json
{ "error": { "code": "METHOD_NOT_ALLOWED", "message": "DELETE is not allowed on this path." } }
```

**400: bad query** (`GET /books?limit=500`)
```json
{
  "error": {
    "code": "INVALID_QUERY",
    "message": "One or more query parameters are invalid.",
    "details": [{ "field": "limit", "message": "limit must be a whole number from 1 to 100" }]
  }
}
```

### All error codes

| HTTP status | `code` | When |
|---|---|---|
| 400 | `INVALID_JSON` | Body is empty or is not valid JSON |
| 400 | `INVALID_QUERY` | A query parameter is invalid |
| 400 | `BAD_REQUEST` | The URL itself is malformed |
| 404 | `NOT_FOUND` | No such route, or no book with that id |
| 405 | `METHOD_NOT_ALLOWED` | Path exists but not for that method |
| 409 | `CONFLICT` | Same title and author already exists |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 10,000 bytes |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Content-Type is not `application/json` |
| 422 | `VALIDATION_ERROR` | JSON is fine but a field breaks a rule |
| 500 | `INTERNAL_ERROR` | Our bug. The message is generic, and details go only to the server log |

## Why these status codes

**Success**
- **200 OK** for reads and updates. The response contains the book as it is now.
- **201 Created** for POST, with a `Location` header pointing to the new book, so a client can find it without parsing the body.
- **204 No Content** for DELETE. There is nothing left to return.

**Client mistakes: which 4xx?**
- **400 vs 422.** I use **400** when the request cannot even be understood (broken JSON, empty body, bad query string, malformed URL). I use **422** when the JSON is perfectly readable but a value breaks a rule (blank title, rating of 9). This lets a client tell "fix your syntax" from "fix your data" by status alone. Many APIs use 400 for both, which is also reasonable. The important thing is to pick one rule and apply it consistently.
- **404 for unknown ids and for malformed ids.** An id like `not-a-real-id` can never exist, so "not found" is true, and it avoids a second error type for a case clients cannot act on differently. The id is not repeated back in the message.
- **404 comes before validation errors on PUT and PATCH.** If the book does not exist, telling the client that first is more useful than listing field errors for a request that cannot succeed anyway.
- **405 with an `Allow` header** when the path is real but the method is not (for example `DELETE /books`). It tells the client what it can do. `HEAD` and `OPTIONS` are not implemented, so they also get 405.
- **409 Conflict** for a duplicate title and author. The request is valid, but it clashes with data that already exists. Updating a book to its own current values is not a conflict.
- **413 Payload Too Large** and **415 Unsupported Media Type** are checked before the body is parsed, so large or wrongly-typed bodies are refused cheaply and are never echoed back.

**Server mistakes**
- **500** is only for bugs. The user sees a generic message, and the real error is written to the server's stderr. Stack traces, file paths and the request body never appear in a response.

**PUT or PATCH?**
- **PUT** replaces the whole book. Any field you leave out (only `rating` is optional) goes back to its default, so the same PUT always gives the same result.
- **PATCH** changes only what you send, then checks that the *combined* book is still valid. For example, changing a finished, rated book to `reading` without clearing `rating` is rejected with 422 and nothing is saved.

## Limitations (on purpose)

- **Not for production.** There is no authentication, no HTTPS, no CORS and no rate limiting. The server only listens on `127.0.0.1`.
- **Data is lost on restart**, and the number of books is not capped.
- **`DELETE` is not repeatable.** Deleting the same book twice gives 204, then 404.
- `HEAD` and `OPTIONS` requests are not supported.
- Unknown query parameters are ignored, but unknown body fields are rejected.

## Tests

```bash
npm test
```

The 46 tests in `test/api.test.js` start the real server on a random port and use `fetch`, so they check actual HTTP behaviour, not just functions. They cover:

- every endpoint's success path, including `Location`, trimming, defaults, filters and pagination
- 20 different bad create bodies (missing, wrong type, too long, control characters, bad status, bad rating, unknown fields)
- all problems being reported together, non-object bodies, broken and empty JSON, wrong Content-Type, oversized body
- bad query parameters, PUT and PATCH rules, duplicates on POST, PUT and PATCH
- 404 for unknown and malformed ids, 405 with `Allow`, and a 500 that leaks nothing
- that every error has the same shape and never contains a stack trace

## Project layout

```
openapi.yaml       the API specification (OpenAPI 3.0)
src/server.js      starts the server (127.0.0.1, port 3000 or $PORT)
src/app.js         routing, request reading, error handling
src/validate.js    validation rules for books
src/store.js       in-memory storage and the fictional sample data
src/errors.js      the ApiError class
test/api.test.js   the tests
```

## License

MIT
