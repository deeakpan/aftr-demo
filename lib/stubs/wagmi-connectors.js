/** Minimal wagmi connectors entry — only what Privy needs (avoids MetaMask SDK / WalletConnect bundle errors). */
const { injected, mock } = require("@wagmi/core");

module.exports = { injected, mock };
