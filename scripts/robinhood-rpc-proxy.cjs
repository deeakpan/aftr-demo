/* eslint-disable no-console */
/**
 * Local JSON-RPC proxy when system DNS cannot resolve rpc.mainnet.chain.robinhood.com.
 * Forwards to a pinned Cloudflare anycast IP with correct TLS SNI.
 */
const http = require("http");
const https = require("https");

const TARGET_HOST = "rpc.mainnet.chain.robinhood.com";
const TARGET_IP = process.env.ROBINHOOD_RPC_IP || "172.66.147.70";
const PORT = Number(process.env.ROBINHOOD_RPC_PROXY_PORT || 8545);

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const proxyReq = https.request(
      {
        host: TARGET_IP,
        port: 443,
        path: req.url || "/",
        method: req.method,
        servername: TARGET_HOST,
        headers: {
          host: TARGET_HOST,
          "content-type": req.headers["content-type"] || "application/json",
          "content-length": body.length,
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, {
          "content-type": proxyRes.headers["content-type"] || "application/json",
        });
        proxyRes.pipe(res);
      },
    );
    proxyReq.on("error", (err) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    });
    proxyReq.end(body);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Robinhood RPC proxy http://127.0.0.1:${PORT} → ${TARGET_HOST} (${TARGET_IP})`);
});
