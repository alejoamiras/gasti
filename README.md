# Expense Tracking Telegram Bot

A Telegram bot that helps you track expenses by processing receipts (images/PDFs) and text messages, automatically logging them to Google Sheets.

## Features

- 📸 **Photo Receipt Processing**: Send a photo of a receipt and the bot extracts expense data
- 📄 **PDF Receipt Processing**: Upload PDF receipts for automatic data extraction
- 💬 **Text Expense Logging**: Send expense details as text without needing a receipt
- 🤖 **AI-Powered**: Uses GPT-4 Vision for intelligent data extraction
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
- `BASE64_ENCODED_GOOGLE_SHEETS_CREDENTIALS`: Google service account credentials, base64-encoded JSON string (see below)
- `GOOGLE_SHEETS_SPREADSHEET_ID`: The ID of your Google Sheets document
- `OPENAI_API_KEY`: Your OpenAI API key (for GPT-4 Vision)
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
