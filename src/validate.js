export const STATUSES = ['to-read', 'reading', 'finished'];
export const KNOWN_FIELDS = ['title', 'author', 'status', 'rating'];

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function checkText(field, value, max, errors) {
  if (value === undefined) {
    errors.push({ field, message: `${field} is required` });
    return undefined;
  }
  if (typeof value !== 'string') {
    errors.push({ field, message: `${field} must be a string` });
    return undefined;
  }
  const text = value.trim();
  if (text.length === 0) {
    errors.push({ field, message: `${field} must not be empty` });
  } else if (text.length > max) {
    errors.push({ field, message: `${field} must be at most ${max} characters` });
  } else if (CONTROL_CHARS.test(text)) {
    errors.push({ field, message: `${field} must not contain control characters` });
  } else {
    return text;
  }
  return undefined;
}

// Fields the client sent that we do not know. Rejecting them catches typos and
// stops clients from trying to set server-controlled fields like id or createdAt.
export function unknownFieldErrors(input) {
  return Object.keys(input)
    .filter((key) => !KNOWN_FIELDS.includes(key))
    .map((key) => ({ field: key.slice(0, 40), message: 'is not a recognised field' }));
}

// Validates a complete candidate book. Returns { errors, value }.
export function validateBook(candidate) {
  const errors = [];
  const title = checkText('title', candidate.title, 200, errors);
  const author = checkText('author', candidate.author, 100, errors);

  let status;
  if (candidate.status === undefined) {
    errors.push({ field: 'status', message: 'status is required' });
  } else if (!STATUSES.includes(candidate.status)) {
    errors.push({ field: 'status', message: `status must be one of: ${STATUSES.join(', ')}` });
  } else {
    status = candidate.status;
  }

  let rating = null;
  const r = candidate.rating;
  if (r !== undefined && r !== null) {
    if (typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > 5) {
      errors.push({ field: 'rating', message: 'rating must be a whole number from 1 to 5, or null' });
    } else if (status && status !== 'finished') {
      errors.push({ field: 'rating', message: 'rating can only be set when status is "finished"' });
    } else {
      rating = r;
    }
  }

  return { errors, value: { title, author, status, rating } };
}
