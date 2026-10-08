import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createStore, seed } from './store.js';

const port = Number(process.env.PORT) || 3000;
const store = createStore();
if (process.argv.includes('--seed')) seed(store);

// Bound to localhost on purpose: this is a local demo, not a hardened public service.
createServer(createApp({ store })).listen(port, '127.0.0.1', () => {
  console.log(`Reading List API running at http://127.0.0.1:${port}`);
  console.log(process.argv.includes('--seed') ? 'Loaded 3 fictional sample books.' : 'Starting empty. Use "npm run demo" for sample books.');
});
