/* eslint-disable no-console */
/**
 * DEPRECATED — Price/NAD settlement bot moved to standalone package:
 *
 *   cd settlement-bot
 *   npm install
 *   cp .env.example .env   # set PRIVATE_KEY
 *   npm start              # or: npm start -- --interval 30
 *
 * From repo root: npm run bot:settle
 */
console.error(
  [
    "scripts/settlement-bot.cjs is deprecated.",
    "Use the standalone package instead:",
    "",
    "  cd settlement-bot && npm install && npm start",
    "",
    "Or from repo root: npm run bot:settle",
  ].join("\n"),
);
process.exit(1);
