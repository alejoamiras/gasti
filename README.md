# Expense Tracking Telegram Bot

## Setup

1. Install dependencies:
   ```sh
   yarn install
   ```
2. Lint the code:
   ```sh
   yarn lint
   ```
3. Format the code:
   ```sh
   yarn format
   ```

## Project Structure

- `src/` — All source code lives here
- `eslint.config.js` — ESLint flat config (lints only src/)
- `.prettierrc` — Prettier formatting rules

## Linting & Formatting

- ESLint (Airbnb + TypeScript + Prettier)
- Prettier for code formatting
- Only files in `src/` are linted

## Environment Variables

Create a `.env` file in the project root with the following variables:

- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token
- `BASE64_ENCODED_GOOGLE_SHEETS_CREDENTIALS`: Google service account credentials, base64-encoded JSON string (see below)
- `GOOGLE_SHEETS_SPREADSHEET_ID`: The ID of your Google Sheets document
- `OPENAI_API_KEY`: Your OpenAI API key (for GPT-4 Vision)
- `LOG_LEVEL`: (optional) Log level for pino logger (default: info)

### How to encode Google Sheets credentials

1. Download your Google service account JSON file
2. Run: `base64 <your-credentials.json>`
3. Copy the output and set it as the value for `BASE64_ENCODED_GOOGLE_SHEETS_CREDENTIALS`

## Testing

### Local Testing

```sh
yarn test
```

### CI/Memory-Constrained Testing

For CI environments or systems with limited memory, use the optimized test script:

```sh
yarn test:ci
```

This script includes memory optimizations:

- Reduced heap size (`--max-old-space-size=2048`)
- Serial test execution (`--runInBand`)
- Memory usage logging (`--logHeapUsage`)
- Force exit for clean CI runs (`--forceExit`)

## Next Steps

- Set up CI (GitHub Actions)
- Scaffold Telegram bot
- Integrate Google Sheets and LLM OCR

## Deployment (Railway)

This bot is designed to run as a persistent process (not serverless). Railway is recommended for easy Node.js bot deployment.

1. [Create a Railway account](https://railway.app/)
2. Link your GitHub repo or deploy manually
3. Set environment variables in the Railway dashboard (see .env.template)
4. Deploy! Railway will use the Procfile and start the bot with `yarn start`.
