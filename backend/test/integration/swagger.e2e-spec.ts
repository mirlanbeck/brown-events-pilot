import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_ROUTES } from '../../src/common/http-middleware';
import { createTestApp, type TestApp } from './helpers';

interface Doc {
  paths: Record<string, Record<string, { operationId?: string; summary?: string; responses: Record<string, { content?: Record<string, { example?: unknown }> }>; requestBody?: { content: Record<string, { examples?: object }> } }>>;
  servers?: { url: string }[];
}
const METHODS = ['get', 'post', 'put', 'delete', 'patch'];
const reference = JSON.parse(readFileSync(join(__dirname, '../fixtures/reference/swagger.json'), 'utf8')) as Doc;
const operations = (doc: Doc) =>
  Object.entries(doc.paths)
    .flatMap(([path, item]) => Object.entries(item).filter(([m]) => METHODS.includes(m)).map(([m, op]) => `${m.toUpperCase()} ${path} ${op.operationId}`))
    .sort();

let t: TestApp;
let doc: Doc;
beforeAll(async () => {
  t = await createTestApp();
  doc = (await t.http().get('/swagger/v1/swagger.json').set('Host', 'example.test:5000')).body as Doc;
});
afterAll(() => t.close());

describe('Swagger (spec 5.8, DoD-10)', () => {
  it('has exactly the operations of the .NET document', () => {
    expect(operations(doc)).toEqual(operations(reference));
  });
  it('agrees with the 405 route table', () => {
    const fromDoc = Object.fromEntries(Object.entries(doc.paths).map(([p, item]) => [p, Object.keys(item).filter((m) => METHODS.includes(m)).map((m) => m.toUpperCase()).sort()]));
    const fromTable = Object.fromEntries(API_ROUTES.map((r) => [r.path, [...r.methods].sort()]));
    expect(fromDoc).toEqual(fromTable);
  });
  it('documents every operation with a summary, error examples and request examples', () => {
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(item).filter(([m]) => METHODS.includes(m))) {
        expect({ path, method, summary: op.summary }).toMatchObject({ summary: expect.any(String) });
        expect(Object.keys(op.responses)).toContain('500');
        for (const [code, response] of Object.entries(op.responses).filter(([c]) => Number(c) >= 400)) {
          expect({ path, method, code, example: response.content?.['application/json']?.example }).toMatchObject({ example: expect.anything() });
        }
        if (method === 'post' || method === 'put') {
          expect(Object.keys(op.requestBody?.content['application/json']?.examples ?? {}).length).toBeGreaterThan(0);
        }
      }
    }
  });
  it('advertises the host the document was requested from', () => {
    expect(doc.servers).toEqual([{ url: 'http://example.test:5000' }]);
  });
  it('does not contain /health or the old "Known issues"', () => {
    expect(Object.keys(doc.paths)).not.toContain('/health');
    expect(JSON.stringify(doc)).not.toContain('Known issues');
  });
  it('serves the UI at /swagger and /swagger/index.html (A16)', async () => {
    const ui = await t.http().get('/swagger').redirects(1);
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('BrownEvents API');
    const legacy = await t.http().get('/swagger/index.html');
    expect(legacy.status).toBe(200);
    expect(legacy.text).toContain('BrownEvents API');
  });
  it('is switched off unless SWAGGER_ENABLED is exactly "true" (SEC-5)', async () => {
    const off = await createTestApp({ env: { SWAGGER_ENABLED: 'TRUE' } });
    const ui = await off.http().get('/swagger');
    const json = await off.http().get('/swagger/v1/swagger.json');
    await off.close();
    expect([ui.status, json.status]).toEqual([404, 404]);
    expect(json.body.message).toBe('Route not found');
  });
});
