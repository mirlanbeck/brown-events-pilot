/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'test/integration/.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  globalSetup: '<rootDir>/test/integration/setup/global-setup.ts',
  testTimeout: 30000,
  maxWorkers: 1,
};
