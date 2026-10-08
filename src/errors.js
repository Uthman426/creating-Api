// An error we expected, with the HTTP status and a stable machine-readable code.
export class ApiError extends Error {
  constructor(status, code, message, { details, headers } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}
