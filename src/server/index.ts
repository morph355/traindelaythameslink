import { RttClient } from "../rtt/client.js";
import { createApp } from "./app.js";

const username = process.env.RTT_USERNAME;
const password = process.env.RTT_PASSWORD;

if (!username || !password) {
  console.error(
    "Missing RTT_USERNAME/RTT_PASSWORD. Copy .env.example to .env and fill in your " +
      "Realtime Trains API credentials from https://api-portal.rtt.io/.",
  );
  process.exit(1);
}

const authUsername = process.env.APP_USERNAME;
const authPassword = process.env.APP_PASSWORD;
const auth = authUsername && authPassword ? { username: authUsername, password: authPassword } : undefined;

if (!auth) {
  console.warn(
    "APP_USERNAME/APP_PASSWORD are not set - this app has NO password protection. " +
      "That's fine on your home LAN, but do not expose it to the internet (e.g. via a " +
      "reverse proxy) without setting both.",
  );
}

const client = new RttClient({ username, password });
const app = createApp(client, { auth });
const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`Thameslink Delay Repay checker listening on http://localhost:${port}`);
});
