export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? 'postgresql://brown:brown123@127.0.0.1:15432/brownevents_test';
}
