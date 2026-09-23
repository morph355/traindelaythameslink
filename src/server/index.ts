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

const client = new RttClient({ username, password });
const app = createApp(client);
const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`Thameslink Delay Repay checker listening on http://localhost:${port}`);
});
