import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiContext, createConference, createSession, uniq, type Conference, type Session } from '../support/api.js';

// Flow 1 (spec 5.1): conference list → conference detail → session detail.
test.describe('Flow 1: browse conferences', () => {
  let api: APIRequestContext;
  let conference: Conference;
  let first: Session;
  let second: Session;

  test.beforeAll(async () => {
    api = await apiContext();
    conference = await createConference(api, uniq('E2E Browse'));
    first = await createSession(api, conference.id, { title: uniq('Browse talk A'), capacity: 30, hour: 10 });
    second = await createSession(api, conference.id, { title: uniq('Browse talk B'), capacity: 40, hour: 12 });
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test('list → conference detail → session detail', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('.card').filter({ has: page.getByText(conference.title, { exact: true }) });
    await expect(card).toHaveCount(1);
    await expect(card.getByText('UPCOMING')).toBeVisible();

    await card.getByRole('link', { name: 'View Details' }).click();
    await expect(page).toHaveURL(`/conferences/${conference.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(conference.title);
    const firstCard = page.locator('.session-card').filter({ hasText: first.title });
    await expect(firstCard).toBeVisible();
    await expect(page.locator('.session-card').filter({ hasText: second.title })).toBeVisible();

    await firstCard.getByRole('link', { name: 'Details →' }).click();
    await expect(page).toHaveURL(`/conferences/${conference.id}/sessions/${first.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(first.title);
    await expect(page.getByText('0 / 30 registered')).toBeVisible();
  });

  test('an unknown conference shows an error and no sessions', async ({ page }) => {
    await page.goto('/conferences/2147483647');
    await expect(page.getByRole('heading', { name: 'Failed to load conference' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sessions' })).toHaveCount(0);
  });
});
