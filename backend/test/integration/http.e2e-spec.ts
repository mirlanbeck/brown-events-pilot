import { createTestApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('error format and request id (spec 5.6)', () => {
  it('answers an unknown route with the JSON error and a server-made request id', async () => {
    const res = await t.http().get('/api/nothing-here').set('X-Request-Id', 'injected<script>');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'Route not found', requestId: res.headers['x-request-id'] });
    expect(res.headers['x-request-id']).toMatch(UUID);
  });
  it.each(['/nothing.json', '/swagger-ui', '/'])('answers %s outside /api with the same JSON error, never HTML (spec 5.6)', async (path) => {
    const res = await t.http().get(path).set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'Route not found', requestId: res.headers['x-request-id'] });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});

describe('405 (spec 5.6)', () => {
  it('lists the allowed methods', async () => {
    const res = await t.http().delete('/api/conferences/2');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET, PUT');
    expect(res.body.message).toBe('Method DELETE is not allowed for this path');
  });
  it('keeps 404 for paths outside the table (A21)', async () => {
    expect((await t.http().delete('/api/conferences/2/registrations/1')).status).toBe(404);
  });
});

describe('415 and body parsing (spec 5.4, 5.6)', () => {
  it('rejects POST without Content-Type', async () => {
    const res = await t.http().post('/api/speakers').send('{"firstName":"A"}');
    expect(res.status).toBe(415);
    expect(res.body.message).toBe('Content-Type must be application/json');
  });
  it.each(['text/plain', 'text/json', 'application/x-www-form-urlencoded'])('rejects %s', async (type) => {
    expect((await t.http().post('/api/speakers').set('Content-Type', type).send('{}')).status).toBe(415);
  });
  it('accepts application/json with parameters and +json types (route missing -> 404, not 415)', async () => {
    expect((await t.http().post('/api/nothing').set('Content-Type', 'application/json; charset=utf-8').send('{}')).status).toBe(404);
    expect((await t.http().post('/api/nothing').set('Content-Type', 'application/merge-patch+json').send('{}')).status).toBe(404);
  });
  it('answers malformed JSON with 400 and without the parser text (B04)', async () => {
    const res = await t.http().post('/api/speakers').set('Content-Type', 'application/json').send('{"title":');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Request body is not valid JSON');
    expect(JSON.stringify(res.body)).not.toMatch(/Unexpected|position/);
  });
  it.each(['"x"', '1', 'null'])('rejects the primitive body %s with 400 (Review Focus 1)', async (body) => {
    const res = await t.http().post('/api/speakers').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(400);
  });
  it('answers an oversized body with 413', async () => {
    const res = await t.http().post('/api/speakers').set('Content-Type', 'application/json').send(JSON.stringify({ bio: 'x'.repeat(110_000) }));
    expect(res.status).toBe(413);
    expect(res.body.statusCode).toBe(413);
  });
});

describe('CORS (spec 5.7, SEC-4, audit step 3)', () => {
  it('allows the frontend origin and exposes X-Request-Id', async () => {
    const res = await t.http().get('/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-expose-headers']).toBe('X-Request-Id');
  });
  it('keeps CORS headers on errors (CFG-3)', async () => {
    const res = await t.http().get('/api/nothing').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(404);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
  it('answers an allowed preflight with max age', async () => {
    const res = await t.http().options('/api/conferences/2/register').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-max-age']).toBe('600');
  });
  it('gives no Access-Control-Allow-Origin to a foreign origin', async () => {
    const preflight = await t.http().options('/api/conferences').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    const get = await t.http().get('/health').set('Origin', 'https://evil.example');
    expect(get.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('/health (spec 9.3)', () => {
  it('is 200 with a database', async () => {
    const res = await t.http().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
  it('is 503 without one', async () => {
    const down = await createTestApp({ env: { DATABASE_URL: 'postgresql://nobody:x@127.0.0.1:1/none' } });
    const res = await down.http().get('/health');
    await down.close();
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('1');
  });
  it('is not under /api', async () => {
    expect((await t.http().get('/api/health')).status).toBe(404);
  });
});
