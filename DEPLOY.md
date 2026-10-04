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

To update later, run `./scripts/update.sh` in that folder over SSH. It
does `git pull`, `docker compose up -d --build` and recreates only the
container - there's no need to remove the project, container or image
first (Docker's layer cache keeps rebuilds quick).

**Your `.env` is never touched by an update.** It's git-ignored, so
`git pull` can't overwrite it. If it gets reset, something else is
rewriting it (e.g. a Task Scheduler task or setup script containing
`cat > .env`) - delete that script rather than re-running it. Edit `.env`
by hand when a value changes, then `docker compose up -d` to apply it.
`RTT_TOKEN` must be the long *issued refresh token* from
https://api-portal.rtt.io/, not the 36-character token ID.

## 4. Expose it outside your LAN

Only do this once `APP_USERNAME`/`APP_PASSWORD` are set in `.env` and the
container's been restarted to pick them up - otherwise this step opens
the app to the internet with no password.

No static IP is not a blocker for the recommended path below - that's
what DDNS is for, not QuickConnect (see the note at the end).

**Recommended: DDNS + reverse proxy**

1. **DDNS** (if you don't already have one): Control Panel → External
   Access → DDNS → add a hostname (e.g. `yourname.synology.me`). This
   updates automatically as your home IP changes, so it doesn't need a
   static IP either.
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

**Alternative: QuickConnect, if you'd rather not touch router port-forwarding**

Control Panel → External Access → QuickConnect → enable it, then use
Application Portal (DSM 7: under Login Portal → Advanced) to give this
app's port (3000) a custom alias - it becomes reachable at
`yourid.quickconnect.to/thealias`, still behind the same Basic Auth
gate. This avoids opening router ports at all, but QuickConnect relays
the connection through Synology's own servers when it can't establish a
direct path, which is an extra hop for your data and has occasional
reports of being unreliable for non-Synology-package traffic - the
reverse proxy route above is more predictable if the router step isn't
a problem.

**If you'd rather not open anything to the public internet at all**, a
VPN into your home network (Synology's own VPN Server, or something like
Tailscale) reaches the app the same way as being on the LAN, with no
reverse proxy, QuickConnect, or password gate needed - worth considering
later if the Basic Auth password feels like more than you want to
manage.
