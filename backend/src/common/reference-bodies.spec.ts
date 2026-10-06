import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CreateConferenceDto, UpdateConferenceDto } from '../conferences/conference.dto';
import { RegisterAttendeeDto } from '../registrations/register.dto';
import { CreateSessionDto, UpdateSessionDto } from '../sessions/session.dto';
import { CreateSpeakerDto } from '../speakers/speaker.dto';
import { ApiError } from './errors';
import { AppValidationPipe } from './validation';

// Request bodies captured from the .NET API (ext150-step0/ref, index.tsv, column "req=").
const bodies = Object.fromEntries(
  readFileSync(join(__dirname, '../../test/fixtures/reference/index.tsv'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const columns = line.split('\t');
      return [columns[0], columns[columns.length - 1].replace(/^req=/, '')];
    }),
) as Record<string, string>;

const pipe = new AppValidationPipe();
const check = (id: string, metatype: new () => object) => pipe.transform(JSON.parse(bodies[id]) as object, { type: 'body', metatype });

describe('bodies the frontend and the reference send are accepted field by field', () => {
  it.each([
    ['B01-post-conference', CreateConferenceDto],
    ['B12-put-conference-999', UpdateConferenceDto],
    ['C01-post-session', CreateSessionDto],
    ['C04-put-session-full', UpdateSessionDto],
    ['D01-post-speaker', CreateSpeakerDto],
    ['D04-register-modal-shape', RegisterAttendeeDto],
    ['D05-register-page-shape', RegisterAttendeeDto],
    ['D06-register-modal-with-session', RegisterAttendeeDto],
  ] as const)('%s', async (id, metatype) => {
    await expect(check(id, metatype)).resolves.toBeInstanceOf(metatype);
  });
});

describe('bodies with unknown or invalid fields are rejected naming them', () => {
  it.each([
    ['B16-post-conference-mass-assign', CreateConferenceDto, ['id', 'registrations', 'sessions']],
    ['C08-put-session-move-conf', UpdateSessionDto, ['conferenceId', 'description']],
    ['B10-put-conference-full', UpdateConferenceDto, ['status']],
  ] as const)('%s', async (id, metatype, fields) => {
    const error = (await check(id, metatype).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.errors?.map((e) => e.field)).toEqual(expect.arrayContaining([...fields]));
  });
});
