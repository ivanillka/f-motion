# F-Motion LinkedIn (n8n)

Dedicated workflow. Do **not** add LinkedIn to Fotium Social Share.

## Public webhook (already live)

Tailscale Funnel on the n8n host exposes **only** this path:

`https://ubuntu-8gb-hel1-2.tailf28d35.ts.net:9452/webhook/fmotion-linkedin`

Root of that port returns 404. The rest of n8n stays tailnet-only on `:9443`.

To turn Funnel off later (on the VPS):

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
   Community Management App Review before org posts succeed. Post as
   organization `144706944` only.

4. From this repo (with `N8N_API_URL` and `N8N_API_KEY` in the environment):

   ```sh
   npm run linkedin:n8n:setup
   ```

5. Open the **F-Motion LinkedIn** workflow, select the LinkedIn credential on
   the LinkedIn node, activate the workflow.

6. Store the same webhook secret in Cursor Cloud secrets as
   `FMOTION_LINKEDIN_WEBHOOK_SECRET`. The weekly automation POSTs:

   ```http
   POST https://ubuntu-8gb-hel1-2.tailf28d35.ts.net:9452/webhook/fmotion-linkedin
   Content-Type: application/json
   x-fmotion-linkedin-secret: <secret>
   ```

   ```json
   {
     "text": "…post body…",
     "url": "https://f-motion.com",
     "source": "plan-054",
     "skip": false
   }
   ```

   Skip week: `"skip": true` (text may be empty).
