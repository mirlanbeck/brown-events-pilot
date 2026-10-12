import { request, type APIRequestContext } from '@playwright/test';

// Test data goes through the API (spec 4.2); only the steps a flow checks go through the UI. Setup runs in Node, so CORS
// does not apply and the API is reached on 127.0.0.1.
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:5000';

// Only the fields the tests read; the backend types are not imported — e2e/ is a separate package.
export interface Conference {
  id: number;
  title: string;
}

export interface Session {
  id: number;
  title: string;
  capacity: number;
}

const suffix = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Unique per run: a rerun on the same stand does not meet the data of the previous one.
export const uniq = (prefix: string): string => `${prefix} ${suffix()}`;
export const uniqEmail = (name: string): string => `e2e.${name}.${suffix()}@example.com`;

// YYYY-MM-DD, `days` from today (UTC). The API takes times without a zone.
function day(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const pad = (n: number): string => String(n).padStart(2, '0');

export const apiContext = (): Promise<APIRequestContext> => request.newContext({ baseURL: API_URL });

async function post<T>(api: APIRequestContext, path: string, data: object): Promise<T> {
  const res = await api.post(path, { data });
  if (!res.ok()) throw new Error(`setup POST ${path} -> ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

// Starts in 30 days: UPCOMING, registration open, sessions not started.
export const createConference = (api: APIRequestContext, title: string): Promise<Conference> =>
  post<Conference>(api, '/api/conferences', { title, startDate: `${day(30)}T00:00:00`, endDate: `${day(31)}T00:00:00` });

// One hour on the first conference day; callers pick different hours so sessions never overlap.
export const createSession = (
  api: APIRequestContext,
  conferenceId: number,
  { title, capacity, hour }: { title: string; capacity: number; hour: number },
): Promise<Session> =>
  post<Session>(api, `/api/conferences/${conferenceId}/sessions`, {
    title,
    startTime: `${day(30)}T${pad(hour)}:00:00`,
    endTime: `${day(30)}T${pad(hour + 1)}:00:00`,
    capacity,
  });

export const registerForConference = (api: APIRequestContext, conferenceId: number, email: string): Promise<unknown> =>
  post<unknown>(api, `/api/conferences/${conferenceId}/register`, { firstName: 'E2E', lastName: 'Attendee', email });
