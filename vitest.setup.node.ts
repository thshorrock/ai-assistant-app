import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

// Stand-in deployment config for the env-driven MCP catalog entries
// (config/mcpCatalog.ts). Set here rather than in the test file because the
// catalog reads process.env at module scope, which runs on import — before any
// beforeAll/vi.stubEnv in the test itself could take effect. Deliberately NOT
// the real deployment's hostname: no environment's identifiers belong in this
// repo, which is the reason the values are env-driven at all.
process.env.MCP_MSF_BASE_URL ??= 'https://mcp.example.test';
process.env.MCP_MSF_API_SCOPE ??=
  'api://00000000-0000-0000-0000-000000000000/Mcp.Invoke';

// Mock localStorage for Zustand persist middleware
// Node.js environment doesn't have localStorage, but Zustand's persist middleware requires it
const localStorageMock = {
  store: {} as Record<string, string>,
  getItem(key: string) {
    return this.store[key] ?? null;
  },
  setItem(key: string, value: string) {
    this.store[key] = value;
  },
  removeItem(key: string) {
    delete this.store[key];
  },
  clear() {
    this.store = {};
  },
  get length() {
    return Object.keys(this.store).length;
  },
  key(index: number) {
    return Object.keys(this.store)[index] ?? null;
  },
};

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Example setup code
beforeAll(() => {
  console.log('Setting up before NodeJS env tests');
});

afterAll(() => {
  console.log('Cleaning up after tests');
});

beforeEach(() => {});

afterEach(() => {});
