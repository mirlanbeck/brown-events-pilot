/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'test/integration/.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  // The generated Prisma client imports its own files as ./x.js (ESM style); map them to the .ts sources.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  globalSetup: '<rootDir>/test/integration/setup/global-setup.ts',
  testTimeout: 30000,
  maxWorkers: 1,
};
