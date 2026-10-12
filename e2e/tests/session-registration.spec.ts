import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  apiContext,
  createConference,
  createSession,
  registerForConference,
  uniq,
  uniqEmail,
  type Conference,
  type Session,
} from '../support/api.js';

// Flow 2 (spec 5.2): session detail → register → the registration is shown and survives a reload.
test.describe('Flow 2: register for a session', () => {
  let api: APIRequestContext;
  let conference: Conference;
  let attendee: string;
  let happy: Session;
  let empty: Session;
  let stranger: Session;

  test.beforeAll(async () => {
    api = await apiContext();
    conference = await createConference(api, uniq('E2E Session registration'));
    attendee = uniqEmail('flow2');
    await registerForConference(api, conference.id, attendee);
    happy = await createSession(api, conference.id, { title: uniq('Registration talk'), capacity: 5, hour: 10 });
    empty = await createSession(api, conference.id, { title: uniq('Empty email talk'), capacity: 5, hour: 12 });
    stranger = await createSession(api, conference.id, { title: uniq('Stranger talk'), capacity: 5, hour: 14 });
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  const open = (page: Page, session: Session) => page.goto(`/conferences/${conference.id}/sessions/${session.id}`);

  test('a registered attendee is counted, also after a reload', async ({ page }) => {
    await open(page, happy);
    await expect(page.getByText('0 / 5 registered')).toBeVisible();
    await page.locator('#session-email').fill(attendee);
    await page.getByRole('button', { name: 'Register for session' }).click();
    await expect(page.getByRole('status')).toHaveText('You are registered for this session.');
    await expect(page.getByText('1 / 5 registered')).toBeVisible();
    await page.reload();
    await expect(page.getByText('1 / 5 registered')).toBeVisible();
  });

  test('an empty email is stopped by the browser and sends nothing', async ({ page }) => {
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/sessions/')) posts.push(r.url());
    });
    await open(page, empty);
    await expect(page.getByText('0 / 5 registered')).toBeVisible();
    await page.getByRole('button', { name: 'Register for session' }).click();
    const valueMissing = await page.locator('#session-email').evaluate((el) => (el as HTMLInputElement).validity.valueMissing);
    expect(valueMissing).toBe(true);
    await expect(page.getByRole('status')).toHaveText('');
    await expect(page.getByRole('alert')).toHaveText('');
    await expect(page.getByText('0 / 5 registered')).toBeVisible();
    expect(posts).toEqual([]);
  });

  test('an attendee without a conference registration is refused', async ({ page }) => {
    await open(page, stranger);
    await page.locator('#session-email').fill(uniqEmail('stranger'));
    await page.getByRole('button', { name: 'Register for session' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Register for the conference before registering for its sessions');
    await expect(alert.getByRole('link', { name: 'Register for conference' })).toBeVisible();
    await expect(page.getByText('0 / 5 registered')).toBeVisible();
  });
});
