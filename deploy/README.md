# Deploying Rep

Rep is one container (Bun) plus one SQLite file on a volume, so a deployment is small.

```bash
docker build -t your-registry/rep:TAG .          # from the repo root
docker push your-registry/rep:TAG
```

Kubernetes manifests live in [`k8s/`](k8s): namespace, volume claim, Deployment, Service and an hourly backup CronJob.
Edit the image, `PUBLIC_URL` and `VAPID_SUBJECT`, then:

```bash
kubectl apply -f k8s/00-namespace.yaml -f k8s/10-pvc.yaml -f k8s/30-service.yaml
kubectl apply -f k8s/20-deployment.yaml
```

Put TLS in front (an ingress, or a tunnel such as Cloudflare Tunnel). The app needs HTTPS for GPS and for installing as a PWA.

**Always run exactly one replica.** SQLite has a single writer and the rate limiters are in-process. [`../docs/SCALING.md`](../docs/SCALING.md)
explains what to change, and when, if you ever need more.

## Sign-in email

Create a Secret named `rep-secrets` with either Amazon SES (`SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_REGION`) or
`RESEND_API_KEY`, and `MAIL_FROM` set to a verified sender. Restart the Deployment after changing it. Without a provider the app
refuses to send in production and prints the link in development.

## Push notifications

VAPID keys are generated and stored in the database on first start. `VAPID_SUBJECT` should be a `mailto:` or `https:` URL you control.
`deploy/gen-vapid.ts` prints a keypair if you would rather supply your own.

## Backups

[`k8s/60-backup-cronjob.yaml`](k8s/60-backup-cronjob.yaml) takes a consistent snapshot every hour, verifies it, and copies it to another
host over ssh. Prove that a backup restores:

```bash
SSH_TARGET=backup@backup.example.com REMOTE_DIR=/srv/backups/rep deploy/restore-drill.sh
```

## Smoke test

```bash
deploy/smoke.sh https://rep.example.com
```
