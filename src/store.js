import { randomUUID } from 'node:crypto';

// In-memory only. Everything is lost when the process stops.
export function createStore({ now = () => new Date().toISOString(), newId = randomUUID } = {}) {
  const books = new Map();
  const keyOf = (title, author) => `${title.toLowerCase()}\u0000${author.toLowerCase()}`;

  return {
    list({ status, q, limit, offset }) {
      let items = [...books.values()];
      if (status) items = items.filter((b) => b.status === status);
      if (q) items = items.filter((b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q));
      return { total: items.length, items: items.slice(offset, offset + limit).map((b) => ({ ...b })) };
    },
    get(id) {
      const book = books.get(id);
      return book ? { ...book } : undefined;
    },
    create(value) {
      const t = now();
      const book = { id: newId(), ...value, createdAt: t, updatedAt: t };
      books.set(book.id, book);
      return { ...book };
    },
    replace(id, value) {
      const book = { ...books.get(id), ...value, updatedAt: now() };
      books.set(id, book);
      return { ...book };
    },
    remove(id) {
      return books.delete(id);
    },
    findDuplicate(title, author, exceptId) {
      const key = keyOf(title, author);
      for (const b of books.values()) {
        if (b.id !== exceptId && keyOf(b.title, b.author) === key) return b;
      }
      return undefined;
    },
  };
}

// Clearly fictional sample data for the demo.
export function seed(store) {
  store.create({ title: 'The Example Atlas', author: 'A. Writer', status: 'to-read', rating: null });
  store.create({ title: 'Notes on Sample Gardens', author: 'B. Author', status: 'reading', rating: null });
  store.create({ title: 'A Short Guide to Placeholders', author: 'C. Novelist', status: 'finished', rating: 4 });
}
