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

Copy `.env.template` to `.env` and fill in the required values:

- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token
- `GOOGLE_SHEETS_CREDENTIALS_JSON`: Google service account credentials (JSON string or path)
- `GOOGLE_SHEETS_SPREADSHEET_ID`: The ID of your Google Sheets document

## Next Steps

- Set up CI (GitHub Actions)
- Scaffold Telegram bot
- Integrate Google Sheets and LLM OCR
