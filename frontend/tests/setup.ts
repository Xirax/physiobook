import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// RTL auto-cleans only when it can see a global `afterEach`, and this workspace
// runs Vitest without globals — so a component mounted by one test would still
// be in the document the next one queries.
afterEach(cleanup);
