import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

// Replays the requests captured from the .NET API (spec 11.4) against the new API and compares answers.
// Only the documented differences are normalised; anything else is a mismatch.
// Usage: node dist/scripts/compare-reference.js [baseUrl] [fixturesDir]   (fresh, seeded database expected)

interface Expectation { status: number; compare: 'data' | 'status' | 'skip'; headers?: Record<string, string | null>; note?: string }
interface Call { id: string; method: string; path: string; body?: string; headers: Record<string, string> }

const BASE = process.argv[2] ?? 'http://127.0.0.1:5098';
const DIR = process.argv[3] ?? join(__dirname, '../../test/fixtures/reference');
const NO_CONTENT_TYPE = new Set(['B02-post-conference-no-ct', 'C03-post-session-no-ct', 'D12-register-no-ct']);
const WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const RELATIONS = new Set(['sessions', 'registrations', 'conference', 'speaker', 'room', 'attendee']);
const DATES = new Set(['startDate', 'endDate', 'startTime', 'endTime']);

const expectations = JSON.parse(readFileSync(join(DIR, 'expectations.json'), 'utf8')) as Record<string, Expectation>;
// Index format: id, method, path, status, size, SELECT=, WRITE=, ct=, loc=, req=. "req=" is "-" (no body),
// "header:Name=Value" / "headers:Name=Value;Name=Value" (request headers, group A) or a JSON body.
function readIndex(file: string): Call[] {
  return readFileSync(join(DIR, file), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line): Call => {
      const col = line.split('\t');
      const req = col[col.length - 1].replace(/^req=/, '');
      const headerList = /^headers?:(.*)$/.exec(req);
      if (headerList) {
        const headers = Object.fromEntries(
          headerList[1].split(';').map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]),
        );
        return { id: col[0], method: col[1], path: col[2], headers };
      }
      const writes = col[1] === 'POST' || col[1] === 'PUT';
      return {
        id: col[0], method: col[1], path: col[2],
        body: req === '-' ? undefined : req,
        headers: writes && !NO_CONTENT_TYPE.has(col[0]) ? { 'Content-Type': 'application/json' } : {},
      };
    });
}
const calls = [...readIndex('index-A.tsv'), ...readIndex('index.tsv')]; // 21 + 45 = 66 reference requests

// The API derives statuses from the real "now" (spec 6.1), so request dates are moved to keep their distance from "now"
// as on the capture day; otherwise the comparison would change its verdict with the calendar (e.g. B01 sends
// status UPCOMING for 2026-11-12, which stops matching on that day, and B12 would turn from 404 into 400).
// - dates inside the reference days of demo conferences 2 and 3 move with the seeded conference (spec 7.5);
// - every other date moves by (run day - capture day). Values with Z or an offset (B08) are not matched and stay as sent.
const CAPTURE_DAY = '2026-10-05'; // Date: header of the reference responses
const REFERENCE_DAYS: Record<number, string> = { 2: '2025-03-05', 3: '2025-06-18' };
const DAY_MS = 86_400_000;
let shifts: { from: number; to: number; delta: number }[] = [];
let runDelta = 0;

async function loadShifts(): Promise<void> {
  shifts = [];
  for (const [id, day] of Object.entries(REFERENCE_DAYS)) {
    const conference = (await (await fetch(`${BASE}/api/conferences/${id}`)).json()) as { startDate: string };
    const from = Date.parse(`${day}T00:00:00Z`);
    shifts.push({ from, to: from + 2 * DAY_MS, delta: Date.parse(`${conference.startDate}Z`) - from });
  }
  const today = new Date();
  runDelta = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - Date.parse(`${CAPTURE_DAY}T00:00:00Z`);
}

function shiftBody(body: string | undefined): string | undefined {
  return body?.replace(/"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"/g, (_match, value: string) => {
    const t = Date.parse(`${value}Z`);
    const delta = shifts.find((s) => t >= s.from && t < s.to)?.delta ?? runDelta;
    return `"${new Date(t + delta).toISOString().slice(0, 19)}"`;
  });
}

function referenceContentType(id: string): string {
  const line = readFileSync(join(DIR, `${id}.headers`), 'utf8')
    .split(/\r?\n/)
    .find((l) => /^content-type:/i.test(l));
  return line ? line.slice(line.indexOf(':') + 1).trim().toLowerCase() : '';
}

function normalize(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return value.map((item) => normalize(item, depth));
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (depth === 0 && Object.keys(record).length === 1 && 'data' in record) return normalize(record.data, depth); // {data} removed (spec 5.1)
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (depth >= 1 && RELATIONS.has(key)) continue; // service fields of nested records (spec 5.2)
    if (key === 'emailPublic') continue; // new field (spec 5.3)
    if (key === 'email' && 'firstName' in record && !('bio' in record)) continue; // attendee email is never returned (spec 5.3)
    if (DATES.has(key)) out[key] = typeof item === 'string' && WALL.test(item) ? '<wall-clock>' : item;
    else if (key === 'registeredAt') out[key] = '<instant>';
    else if (key === 'status' && 'startDate' in record) out[key] = '<derived status>';
    else out[key] = normalize(item, RELATIONS.has(key) ? depth + 1 : depth);
  }
  return out;
}

async function run(): Promise<void> {
  await loadShifts();
  const rows: string[] = ['| id | expected | got | result | note |', '|---|---|---|---|---|'];
  let failures = 0;
  for (const call of calls) {
    const expected = expectations[call.id];
    if (!expected) throw new Error(`No expectation for ${call.id}`);
    if (expected.compare === 'skip') {
      rows.push(`| ${call.id} | skip | - | skipped | ${expected.note ?? ''} |`);
      continue;
    }
    const res = await fetch(`${BASE}${call.path}`, { method: call.method, headers: call.headers, body: shiftBody(call.body) });
    const text = await res.text();
    const problems: string[] = [];
    if (res.status !== expected.status) problems.push(`status ${res.status}`);
    for (const [name, value] of Object.entries(expected.headers ?? {})) {
      if (res.headers.get(name) !== value) problems.push(`${name}: ${res.headers.get(name) ?? 'absent'}`);
    }
    // A successful JSON answer of the reference must stay JSON (the frontend calls res.json()).
    const contentType = res.headers.get('content-type') ?? '';
    if (res.status < 300 && referenceContentType(call.id).startsWith('application/json') && !contentType.startsWith('application/json')) {
      problems.push(`content-type: ${contentType || 'absent'}`);
    }
    if (expected.compare === 'data' && problems.length === 0) {
      const reference = JSON.parse(readFileSync(join(DIR, `${call.id}.body`), 'utf8')) as unknown;
      if (!isDeepStrictEqual(normalize(reference), normalize(JSON.parse(text) as unknown))) problems.push('data differ');
    }
    if (problems.length > 0) failures += 1;
    rows.push(`| ${call.id} | ${expected.status} | ${res.status} | ${problems.length ? `MISMATCH: ${problems.join('; ')}` : 'ok'} | ${expected.note ?? ''} |`);
  }
  const report = `# compare-reference against ${BASE}\n\nMasked: wall-clock values, registeredAt, derived conference status, nested service fields, attendee email, emailPublic.\n\n${rows.join('\n')}\n`;
  writeFileSync('compare-reference-report.md', report);
  console.log(report);
  if (failures > 0) {
    console.error(`${failures} mismatch(es)`);
    process.exit(1);
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
