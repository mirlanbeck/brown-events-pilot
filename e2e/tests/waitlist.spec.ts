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

type Button = 'Register for session' | 'Join waitlist' | 'Cancel my registration';

// Flow 3 (spec 5.3, BEVN-202): fill the session → a stale page is refused → waitlist → a cancel promotes the first waiting.
test.describe('Flow 3: session waitlist', () => {
  let api: APIRequestContext;
  let conference: Conference;
  let session: Session;
  const who: Record<'a' | 'b' | 'c' | 'd', string> = { a: '', b: '', c: '', d: '' };

  test.beforeAll(async () => {
    api = await apiContext();
    conference = await createConference(api, uniq('E2E Waitlist'));
    session = await createSession(api, conference.id, { title: uniq('Waitlist talk'), capacity: 2, hour: 10 });
    for (const name of ['a', 'b', 'c', 'd'] as const) {
      who[name] = uniqEmail(`flow3-${name}`);
      await registerForConference(api, conference.id, who[name]);
    }
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  const act = async (page: Page, email: string, button: Button) => {
    await page.locator('#session-email').fill(email);
    await page.getByRole('button', { name: button }).click();
  };

  test('full → refused → waitlist → cancel → the first waiting is promoted', async ({ page, context }) => {
    const url = `/conferences/${conference.id}/sessions/${session.id}`;
    const stale = page;

    await test.step('tab 1 opens the session while seats are free', async () => {
      await stale.goto(url);
      await expect(stale.getByText('0 / 2 registered')).toBeVisible();
      await expect(stale.getByRole('button', { name: 'Register for session' })).toBeVisible();
    });

    await test.step('tab 2: A and B take both seats', async () => {
      const other = await context.newPage();
      await other.goto(url);
      await act(other, who.a, 'Register for session');
      await expect(other.getByText('1 / 2 registered')).toBeVisible();
      await act(other, who.b, 'Register for session');
      await expect(other.getByText('2 / 2 registered')).toBeVisible();
      await expect(other.getByRole('button', { name: 'Join waitlist' })).toBeVisible();
      await other.close();
    });

    await test.step('tab 1 is stale: C is refused, the page switches to the waitlist', async () => {
      await expect(stale.getByRole('button', { name: 'Register for session' })).toBeVisible();
      await act(stale, who.c, 'Register for session');
      await expect(stale.getByRole('alert')).toHaveText('No seats left in this session; join the waitlist instead');
      await expect(stale.getByText('2 / 2 registered')).toBeVisible();
      await expect(stale.getByRole('button', { name: 'Join waitlist' })).toBeVisible();
    });

    await test.step('C joins the waitlist', async () => {
      await act(stale, who.c, 'Join waitlist');
      await expect(stale.getByRole('status')).toHaveText('You are on the waitlist.');
      await expect(stale.getByText('Waitlist: 1')).toBeVisible();
    });

    await test.step('after a reload only the waitlist is offered; D joins it', async () => {
      await stale.reload();
      await expect(stale.getByRole('button', { name: 'Join waitlist' })).toBeVisible();
      await expect(stale.getByRole('button', { name: 'Register for session' })).toHaveCount(0);
      await act(stale, who.d, 'Join waitlist');
      await expect(stale.getByText('Waitlist: 2')).toBeVisible();
    });

    await test.step('D cannot join twice', async () => {
      await act(stale, who.d, 'Join waitlist');
      await expect(stale.getByRole('alert')).toHaveText('Attendee is already on the waitlist for this session');
      await expect(stale.getByText('Waitlist: 2')).toBeVisible();
    });

    await test.step('A cancels: the seat goes to the waitlist', async () => {
      await act(stale, who.a, 'Cancel my registration');
      await expect(stale.getByRole('status')).toHaveText('Your registration or waitlist place is cancelled.');
      await expect(stale.getByText('Waitlist: 1')).toBeVisible();
      await expect(stale.getByText('2 / 2 registered')).toBeVisible();
    });

    await test.step('C, the first waiting, is registered; D still waits', async () => {
      await act(stale, who.c, 'Join waitlist');
      await expect(stale.getByRole('alert')).toHaveText('Attendee is already registered for this session');
      await act(stale, who.d, 'Join waitlist');
      await expect(stale.getByRole('alert')).toHaveText('Attendee is already on the waitlist for this session');
    });
  });
});
