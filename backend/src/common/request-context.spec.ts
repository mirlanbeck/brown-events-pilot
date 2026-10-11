import { maskPath } from './request-context';

describe('maskPath (BEVN-203 spec 4.8)', () => {
  it.each([
    ['/api/attendees/ann%40example.com/registrations', '/api/attendees/***/registrations'],
    ['/api/attendees/ann@example.com/registrations/7/cancel', '/api/attendees/***/registrations/7/cancel'],
    ['/api/attendees/ann%40example.com/unknown/tail', '/api/attendees/***/unknown/tail'],
    ['/api/attendees/ann%40example.com/registrations?q=1', '/api/attendees/***/registrations?q=1'],
    ['/api/attendees/ann%40example.com', '/api/attendees/***'],
    ['/API/Attendees/ann%40example.com/registrations', '/API/Attendees/***/registrations'],
  ])('masks %s', (url, masked) => {
    expect(maskPath(url)).toBe(masked);
  });
  it.each(['/api/conferences/2', '/api/attendees', '/api/attendees/', '/health'])('leaves %s as it is', (url) => {
    expect(maskPath(url)).toBe(url);
  });
});
