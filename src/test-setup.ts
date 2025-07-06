// Jest test setup - runs before each test file
process.env.NODE_ENV = 'test';

// Suppress logging during tests
process.env.LOG_LEVEL = 'silent';

// Mock Telegram bot token for tests
if (!process.env.TELEGRAM_BOT_TOKEN) {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
}
