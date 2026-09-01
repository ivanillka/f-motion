# F-Motion LinkedIn (n8n)

Dedicated workflow. Do **not** add LinkedIn to other social-share stacks.

## Public webhook

Expose **only** the webhook path on your n8n host, for example:

`https://YOUR_N8N_HOST:9452/webhook/fmotion-linkedin`

Keep the rest of n8n on a private port or tailnet.

To turn a Tailscale Funnel off later:

```sh
tailscale funnel --https=9452 off
```

## One-time setup

1. Generate a secret (do not commit it):

   ```sh
   openssl rand -hex 32
   ```

2. On the n8n host, put it in n8n’s environment as
   `FMOTION_LINKEDIN_WEBHOOK_SECRET` and recreate the `n8n` service.

3. In n8n, create **LinkedIn Community Management OAuth2** credentials.
   Enable organization posting (`w_organization_social`). LinkedIn may require
   Community Management App Review before org posts succeed. Set your company
   organization id on the LinkedIn node after import.

4. From this repo (with `N8N_API_URL` and `N8N_API_KEY` in the environment):

   ```sh
   npm run linkedin:n8n:setup
   ```

5. Open the **F-Motion LinkedIn** workflow, select the LinkedIn credential on
   the LinkedIn node, set the organization id, activate the workflow.

6. Store the same webhook secret in your automation host as
   `FMOTION_LINKEDIN_WEBHOOK_SECRET`. Example POST:

   ```http
   POST https://YOUR_N8N_HOST:9452/webhook/fmotion-linkedin
   Content-Type: application/json
   x-fmotion-linkedin-secret: <secret>
   ```

   ```json
   {
     "text": "…post body…",
     "url": "https://f-motion.com",
     "source": "weekly-post",
     "skip": false
   }
   ```

   Skip week: `"skip": true` (text may be empty).
