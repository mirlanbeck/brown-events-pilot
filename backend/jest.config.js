/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'src/.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  // The generated Prisma client imports its own files as ./x.js (ESM style); map them to the .ts sources.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
};
