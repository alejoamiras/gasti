# Expense Tracking Telegram Bot

A Telegram bot that helps you track expenses by processing receipts (images/PDFs) and text messages, automatically logging them to Google Sheets.

## Features

- 📸 **Photo Receipt Processing**: Send a photo of a receipt and the bot extracts expense data
- 📄 **PDF Receipt Processing**: Upload PDF receipts for automatic data extraction
- 💬 **Text Expense Logging**: Send expense details as text without needing a receipt
- 🤖 **AI-Powered**: Uses OpenAI (`gpt-6-luna` by default) with structured outputs for data extraction
- 📊 **Google Sheets Integration**: Automatically logs expenses to your spreadsheet
- 🇦🇷 **Localized for Argentina**: Understands Spanish and local terminology

## How to Use

### Photo/PDF Receipts

1. Take a photo of your receipt or save it as PDF
2. Send it to the bot (optionally with a caption for context)
3. The bot extracts the data and logs it to Google Sheets

### Text Expenses

Send a text message with expense details. The bot understands various formats:

- Simple: `"Almuerzo 1500 🍕"`
- Descriptive: `"Pagué $2500 en el super por compras de la semana"`
- English/Spanish mix: `"Uber to airport: 3200 ARS"`
- Abbreviated: `"Super chino 5430"` or `"Café con Mora 2800"`

The bot will intelligently parse the text, categorize the expense, and log it.

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
- `TELEGRAM_ALLOWED_USERS`: Who may use the bot, as `<telegram user id>:<payer>` pairs separated by commas (e.g. `123456:alejo,789012:mora`). The payer must match the sheet's **Paga** dropdown. Messages from anyone else are ignored and logged with their user id.
- `BASE64_ENCODED_GOOGLE_SHEETS_CREDENTIALS`: Google service account credentials, base64-encoded JSON string (see below)
- `GOOGLE_SHEETS_SPREADSHEET_ID`: The ID of your Google Sheets document
- `OPENAI_API_KEY`: Your OpenAI API key
- `OPENAI_MODEL`: (optional) OpenAI model id (default: `gpt-6-luna`); it must support image input and structured outputs
- `LOG_LEVEL`: (optional) Log level for pino logger (default: info)

### How to encode Google Sheets credentials

1. Download your Google service account JSON file
2. Run: `base64 <your-credentials.json>`
3. Copy the output and set it as the value for `BASE64_ENCODED_GOOGLE_SHEETS_CREDENTIALS`

## Testing

Tests are organized into unit and integration tests in the `src/tests/` directory.

### Local Testing

Run all tests:

```sh
yarn test
```

The real OpenAI test in `src/library/llm.test.ts` is skipped unless `OPENAI_API_KEY` is set. `test.env.example` points at the key in 1Password, so run it with `op run --env-file=test.env.example -- bun test src/library/llm.test.ts` on a machine with the 1Password CLI, or as a keyed run from a remote host (`env-exec request --template test.env.example --slug llm -- bun test src/library/llm.test.ts`).

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

## Spreadsheet layout

The bot writes to the tab named after the current month in Argentina time plus the two-digit year, e.g. `octubre 26`, and fails with a clear message if that tab doesn't exist. Rows start at row 3, with columns B `Gasto`, C `Moneda`, D `Monto`, E `ARS` (copied from E3's formula), F `Paga`, G `Categoría`, H `Tipo` (always `variable`) and I `Comments`.

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
