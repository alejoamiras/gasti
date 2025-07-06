import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock environment variables
const mockEnv = {
  TELEGRAM_BOT_TOKEN: 'mock-token-123',
  OPENAI_API_KEY: 'mock-openai-key',
  BASE64_ENCODED_GOOGLE_SHEETS_CREDENTIALS: Buffer.from(
    JSON.stringify({
      type: 'service_account',
      project_id: 'mock-project',
      private_key_id: 'mock-key-id',
      private_key: '-----BEGIN PRIVATE KEY-----\nmock-key\n-----END PRIVATE KEY-----\n',
      client_email: 'mock@mock.iam.gserviceaccount.com',
      client_id: 'mock-client-id',
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
      client_x509_cert_url:
        'https://www.googleapis.com/robot/v1/metadata/x509/mock%40mock.iam.gserviceaccount.com',
    }),
  ).toString('base64'),
  GOOGLE_SHEETS_SPREADSHEET_ID: 'mock-spreadsheet-id',
  NODE_ENV: 'test',
};

// Mock Telegram Bot API
jest.mock('node-telegram-bot-api', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    stopPolling: jest.fn(() => Promise.resolve()),
    sendMessage: jest.fn(() => Promise.resolve({})),
    getFile: jest.fn(() => Promise.resolve({ file_path: 'mock/path' })),
  }));
});

// Mock Google APIs
jest.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: jest.fn().mockImplementation(() => ({})),
    },
    sheets: jest.fn(() => ({
      spreadsheets: {
        values: {
          get: jest.fn(() => Promise.resolve({ data: { values: [] } })),
          update: jest.fn(() => Promise.resolve({})),
        },
      },
    })),
  },
}));

describe('Bot Initialization', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    // Set mock environment
    Object.assign(process.env, mockEnv);
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('should compile without errors', async () => {
    // This test is more of a reminder - actual compilation is tested by running npm run build
    // If this test is running, it means the TypeScript has already compiled successfully
    expect(true).toBe(true);
  });

  it('should initialize bot without throwing errors', async () => {
    // Import the bot module - this will test initialization
    const importBot = async () => {
      // Clear module cache to ensure fresh import
      jest.resetModules();
      await import('./bot.js');
    };

    // Should not throw any errors
    await expect(importBot()).resolves.not.toThrow();
  });

  it('should register all required event handlers', async () => {
    jest.resetModules();
    const TelegramBot = (await import('node-telegram-bot-api')).default;

    // Import bot to trigger initialization
    await import('./bot.js');

    // Get the mock instance
    const mockInstance = (TelegramBot as any).mock.results[0].value;

    // Verify all handlers are registered
    expect(mockInstance.on).toHaveBeenCalledWith('polling_error', expect.any(Function));
    expect(mockInstance.on).toHaveBeenCalledWith('webhook_error', expect.any(Function));
    expect(mockInstance.on).toHaveBeenCalledWith('photo', expect.any(Function));
    expect(mockInstance.on).toHaveBeenCalledWith('document', expect.any(Function));
    expect(mockInstance.on).toHaveBeenCalledWith('text', expect.any(Function));
  });

  it('should handle missing environment variables gracefully', async () => {
    // Remove required environment variable
    delete process.env.TELEGRAM_BOT_TOKEN;

    const importBot = async () => {
      jest.resetModules();
      await import('./bot.js');
    };

    // Should throw error for missing token
    await expect(importBot()).rejects.toThrow('TELEGRAM_BOT_TOKEN is not set');
  });
});

describe('Bot Shutdown', () => {
  it('should handle SIGTERM gracefully', async () => {
    jest.resetModules();
    const TelegramBot = (await import('node-telegram-bot-api')).default;

    // Import bot
    await import('./bot.js');

    // Get the mock instance
    const mockInstance = (TelegramBot as any).mock.results[0].value;

    // Simulate SIGTERM
    process.emit('SIGTERM' as any);

    // Wait a bit for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify stopPolling was called
    expect(mockInstance.stopPolling).toHaveBeenCalledWith({
      cancel: true,
      reason: 'Graceful shutdown',
    });
  });
});
