import { createAgentMailClient } from "../tickets/agentmailClient.js";
import { processJourneyRequests } from "../tickets/processJourneyRequests.js";
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

const agentMailApiKey = process.env.AGENTMAIL_API_KEY;
const inboxId = process.env.AGENTMAIL_INBOX_ID;
const ownerEmail = process.env.AGENTMAIL_OWNER_EMAIL;

if (agentMailApiKey && inboxId && ownerEmail) {
  const agentMail = createAgentMailClient(agentMailApiKey);
  const pollSeconds = Number(process.env.AGENTMAIL_POLL_SECONDS ?? 60);
  const appUrl = process.env.APP_URL;

  console.log(
    `Watching ${inboxId} for journey-check emails from ${ownerEmail} every ${pollSeconds}s.`,
  );

  setInterval(() => {
    processJourneyRequests({ agentMail, rtt: client, inboxId, ownerEmail, appUrl })
      .then(({ processed }) => {
        if (processed > 0) console.log(`Replied to ${processed} journey-check email(s).`);
      })
      .catch((err) => {
        console.error("Error while checking for journey-check emails:", err);
      });
  }, pollSeconds * 1000);
} else {
  console.warn(
    "AGENTMAIL_API_KEY/AGENTMAIL_INBOX_ID/AGENTMAIL_OWNER_EMAIL are not all set - " +
      "emailing 'out: HH:MM' / 'back: HH:MM' for an automatic reply is disabled.",
  );
}
