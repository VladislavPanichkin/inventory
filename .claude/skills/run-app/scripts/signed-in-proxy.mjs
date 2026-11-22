/**
 * Signs in to the local backend once and then forwards every request to it with that
 * session attached. Point the frontend dev server at this proxy and a headless browser
 * sees the app as a signed-in user, without typing a password into a page.
 *
 *   APP_EMAIL=... APP_PASSWORD=... node signed-in-proxy.mjs
 *
 * Optional: BACKEND_PORT (default 3000), PROXY_PORT (default 3100).
 * Local development only. The credentials are read from the environment and never printed.
 */
import { createServer, request } from "node:http";

const backendPort = Number(process.env.BACKEND_PORT ?? 3000);
const proxyPort = Number(process.env.PROXY_PORT ?? 3100);
const { APP_EMAIL: email, APP_PASSWORD: password } = process.env;
if (!email || !password) {
  console.error("Set APP_EMAIL and APP_PASSWORD.");
  process.exit(1);
}

const login = await fetch(`http://127.0.0.1:${backendPort}/api/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) {
  console.error(`Sign-in failed with status ${login.status}. Is the backend running and the account set up?`);
  process.exit(1);
}
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
const role = (await login.json()).data?.role;

createServer((req, res) => {
  const upstream = request(
    {
      host: "127.0.0.1",
      port: backendPort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `localhost:${backendPort}`, cookie },
    },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on("error", () => res.writeHead(502).end());
  req.pipe(upstream);
}).listen(proxyPort, "127.0.0.1", () => {
  console.log(`Signed in as ${role ?? "user"}; forwarding http://127.0.0.1:${proxyPort} -> :${backendPort}`);
});
