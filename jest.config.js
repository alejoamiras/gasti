/** @type {import("jest").Config} **/
export default {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  roots: ['<rootDir>/src'],
  testMatch: ['<rootDir>/src/tests/**/*.test.ts', '<rootDir>/src/**/*.test.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Memory optimization for CI
  maxWorkers: 1, // Single worker to reduce memory usage
  workerIdleMemoryLimit: '512MB', // Kill workers that use too much memory
  clearMocks: true, // Clear mocks between tests
  restoreMocks: true, // Restore original implementations
};
