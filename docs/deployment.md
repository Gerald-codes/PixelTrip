# Deployment

How PixelTrip runs in production and how to deploy it.

| Part | Where | Address |
|---|---|---|
| Frontend (Next.js) | Vercel | `https://pixel-trip-booth.vercel.app` |
| Backend (FastAPI) | One AWS EC2 server in Singapore, running a Docker image | `https://18-138-209-118.sslip.io` |
| Database, Realtime | Supabase | unchanged |

Sized for 20 to 40 users. Expect roughly USD 17 a month for the backend (a `t4g.small`
server, its disk and its public IP); check the AWS pricing page for current figures.

## How the backend is set up

```
browser ──HTTPS──> Caddy (ports 80/443) ──> backend container (port 8000) ──> Supabase, Gemini, RapidAPI
                   └────────── one EC2 server (t4g.small, ARM) ──────────┘
```

- **Image:** built from `backend/Dockerfile` and stored in ECR (`pixeltrip-backend`).
- **HTTPS:** Caddy runs next to the app and gets a free certificate automatically. The
  address uses sslip.io, which turns `1-2-3-4.sslip.io` into the IP `1.2.3.4`, so no
  domain has to be bought. If the team buys a domain later, point it at the server's IP
  and change the hostname in `/opt/pixeltrip/Caddyfile` on the server.
- **Settings and keys:** stored encrypted in AWS Parameter Store under `/pixeltrip/prod`.
  The server reads them on every deploy. They are never in the repo or the image.
- **No SSH:** only ports 80 and 443 are open. Deploys and log access go through AWS
  Systems Manager.

**Run one copy only.** AI runs keep working inside the server process after the request
returns, and the flight-provider rest timers live in its memory. A second copy, or more
uvicorn workers, would not share them.

## First-time setup

You need the AWS CLI logged in to the team's AWS account, and Docker Desktop running.
The scripts use Singapore (`ap-southeast-1`) whatever your CLI default is.

```bash
aws sts get-caller-identity      # confirm you are logged in to the right account

./deploy/aws-setup.sh            # 1. create the ECR repo, server, firewall, fixed IP
./deploy/push-env.sh             # 2. upload the settings from backend/.env
./deploy/deploy.sh               # 3. build the image and start it
```

1. `aws-setup.sh` prints the backend address. It is safe to run again; it reuses what
   exists. Your AWS user needs permission to manage EC2, ECR, IAM roles and Systems
   Manager (an administrator user works).
2. `push-env.sh` uploads every filled-in key from `backend/.env`. It replaces the
   local-only ones: `FRONTEND_URL` allows `https://pixel-trip-booth.vercel.app` and
   `https://aws-pixeltrip.vercel.app`, `ENVIRONMENT`
   becomes `production`, and the `/dev` test routes are switched off. Check
   `backend/.env` has the production keys you want before running it.
3. `deploy.sh` takes a few minutes the first time. Wait about two minutes after step 1
   before running it, so the new server has finished installing Docker. It ends by
   checking `https://<address>/health`.

Then set up the frontend (below).

## Frontend on Vercel

In the Vercel project (owned by the repo owner, connected to this repo), under Settings:

- **Root Directory:** `frontend`
- **Environment Variables** (Production):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SERVICE_MODE` | `real` |
| `NEXT_PUBLIC_API_BASE_URL` | the backend address from `aws-setup.sh`, no trailing slash |
| `NEXT_PUBLIC_SUPABASE_URL` | the Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the Supabase **anon** key |

Leave `NEXT_PUBLIC_ENABLE_DEV_CONSOLE` unset. Never put the Supabase service-role key in
Vercel: every `NEXT_PUBLIC_` value is visible to anyone who opens the site.

These values are baked in when Vercel builds, so **redeploy after changing any of them**.

The default backend configuration accepts browser calls from `https://pixel-trip-booth.vercel.app`
and `https://aws-pixeltrip.vercel.app`. Apply the settings with `push-env.sh` and restart
the backend after changing them. Vercel preview
deployments have different addresses and will be refused. To allow another address, set
`FRONTEND_ORIGIN` to a comma-separated list and run `push-env.sh` again:

```bash
FRONTEND_ORIGIN="https://pixel-trip-booth.vercel.app,https://aws-pixeltrip.vercel.app,https://some-preview.vercel.app" ./deploy/push-env.sh
./deploy/deploy.sh --restart
```

## Day to day

| Task | Command |
|---|---|
| Deploy new backend code | `./deploy/deploy.sh` |
| Change a key or setting | edit `backend/.env`, `./deploy/push-env.sh`, then `./deploy/deploy.sh --restart` |
| Check it is up | `curl https://<address>/health` |
| Read the logs | see below |

A deploy restarts the backend, which takes about ten seconds. An AI run in progress at
that moment is lost; the leader can start it again from the screen. Avoid deploying while
people are mid-session.

Database migrations are not part of a deploy. Run new files from `supabase/migrations/`
in the Supabase SQL editor first, then deploy the code that needs them.

**Logs.** Open a shell on the server from the AWS console (EC2, select the instance,
Connect, Session Manager), or with the Session Manager plugin installed:

```bash
source deploy/config.sh
aws ssm start-session --target "$(instance_id)"
sudo docker logs --tail 200 -f backend     # the app
sudo docker logs --tail 50 caddy           # HTTPS and certificates
```

**Roll back.** Every image is tagged with its git commit. On the server:
`sudo /opt/pixeltrip/update.sh <short-commit>`.

## Upkeep

- **Security updates:** once a month, on the server, `sudo dnf upgrade -y && sudo reboot`.
  The containers start again by themselves.
- **API quotas:** the flight providers have monthly limits; a provider that runs out is
  skipped until it resets. Watch the logs for `429`.
- **Costs:** set an AWS budget alert (Billing, Budgets) so a surprise is caught early.

## Taking it down

```bash
source deploy/config.sh
aws ec2 terminate-instances --instance-ids "$(instance_id)"
aws ec2 release-address --allocation-id "$(aws ec2 describe-addresses \
  --filters Name=tag:Name,Values=$APP_NAME --query 'Addresses[0].AllocationId' --output text)"
aws ecr delete-repository --repository-name "$APP_NAME" --force
```

The fixed IP is billed even when the server is stopped, so release it if the project ends.
The Parameter Store entries, IAM role and security group cost nothing; delete them from
the console if you want a clean account.
