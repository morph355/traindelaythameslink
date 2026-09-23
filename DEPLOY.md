# Deploying to a Synology NAS

## Why email forwarding still works

The app never needs to *receive* email itself. TrainPal confirmations go
to a cloud inbox (`thameslink-tickets@agentmail.to`, via
[AgentMail](https://agentmail.to)) which handles receiving and storage;
the NAS only needs to make outbound HTTPS calls to AgentMail's and RTT's
APIs when you use the app. No inbound mail port, no MX records, no
port-forwarding for SMTP.

## 1. Prerequisites

- DSM 7.2 or later, with **Container Manager** installed from Package
  Center (DSM 7.1 and earlier: install **Docker** instead - the steps
  below are the same, just under a different app name).
- Your `.env` filled in (copy `.env.example`): `RTT_USERNAME`/`RTT_PASSWORD`,
  `AGENTMAIL_API_KEY`, and since you want this reachable from outside
  your LAN, `APP_USERNAME`/`APP_PASSWORD` too (pick a real password - the
  app has no other login).

## 2. Get the project onto the NAS

Either:

- SSH into the NAS and `git clone` this repo into a shared folder (e.g.
  `/volume1/docker/traindelaythameslink`), or
- Use File Station to upload the project as a zip and extract it there.

Put your filled-in `.env` in that same folder (it's git-ignored, so it
won't come from the clone - create it there directly).

## 3. Build and run via Container Manager

1. Container Manager → **Project** → **Create**.
2. Point it at the folder from step 2 (it will detect `docker-compose.yml`).
3. Build and start the project. First build takes a few minutes (it
   compiles TypeScript and installs dependencies inside the image).
4. Confirm it's up: from a device on your LAN, open
   `http://<nas-ip>:3000`.

To update later: `git pull` in that folder, then re-build the project in
Container Manager (or `docker compose up -d --build` over SSH).

## 4. Expose it outside your LAN

Only do this once `APP_USERNAME`/`APP_PASSWORD` are set in `.env` and the
container's been restarted to pick them up - otherwise this step opens
the app to the internet with no password.

1. **DDNS** (if you don't already have one): Control Panel → External
   Access → DDNS → add a hostname (e.g. `yourname.synology.me`).
2. **Certificate**: Control Panel → Security → Certificate → get a Let's
   Encrypt certificate for that hostname (Synology automates renewal).
3. **Reverse proxy**: Control Panel → Login Portal → Advanced → Reverse
   Proxy → Create:
   - Source: HTTPS, your DDNS hostname, port 443 (or a dedicated
     subdomain if you're already using 443 for something else)
   - Destination: HTTP, `localhost`, port 3000
4. **Router**: forward external port 443 (and 80, needed for certificate
   renewal) to the NAS's LAN IP, if that isn't already set up for other
   services.
5. Visit `https://yourname.synology.me/` from outside your network - your
   browser should prompt for the username/password you set.

If you'd rather not open anything to the public internet at all, a VPN
into your home network (Synology's own VPN Server, or something like
Tailscale) reaches the app the same way as being on the LAN, with no
reverse proxy or password gate needed - worth considering later if the
Basic Auth password feels like more than you want to manage.
