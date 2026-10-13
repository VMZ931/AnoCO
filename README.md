# AnoCo

A responsive mental wellbeing support concept for Grade 12 students. AnoCo helps students identify concerns like stress, anxiety, low mood, and relationship difficulties, then shape a question to bring to a trusted adult or school counselor.

## Run locally

Open `index.html` in a browser to preview the site. In-site calls stay unavailable until the Node API and provider accounts are configured. The backend runs from `server/` with Node.js 22 or later.

## Publish with GitHub Pages

1. Create a GitHub repository named `AnoCo` and add the site files to its `main` branch.
2. Keep `.github/workflows/deploy-pages.yml` in the repository. It publishes the static site on each push to `main`.
3. In the repository, open **Settings > Pages** and select **GitHub Actions** as the build and deployment source if it is not selected automatically.
4. Open the **Actions** tab and wait for the `Publish AnoCo to GitHub Pages` workflow to finish. GitHub will show the published URL in the workflow run and Pages settings.

## Prototype and safety

This is not a counseling or crisis service. The form is intentionally frontend-only: its preview does not send, store, or share what a student writes, and no counselor will see it. Do not use the demo to collect real student information. Before offering real consultations, establish a documented privacy and safeguarding process and connect an appropriately secured intake system staffed by qualified people. For immediate danger, the page directs students to a trusted adult or local emergency services.

## In-site audio calls

The call UI uses LiveKit for audio and a Node API for short-lived room tokens. Counselors sign in with Google Identity; the API checks both the configured Workspace domain and an explicit counselor email allowlist. The browser never receives the LiveKit API secret. Student identities and room names are random, microphone-only, and held in memory; AnoCo does not record audio or written previews. LiveKit processes call audio to connect participants.

Calls are not ready for real student use until the school has approved the provider and safeguarding process, configured the accounts below, tested the queue with staff, and provided an always-on backend. The included Render free plan is for setup/testing only: its in-memory counselor presence and call queue are lost on restart, and free services may sleep.

1. Create an approved LiveKit Cloud project and keep its API secret private.
2. In Google Cloud, create a Web OAuth client for `https://vmz931.github.io`; configure the school's Workspace domain and the exact counselor email allowlist.
3. Connect this repository to Render using `render.yaml`. Set `GOOGLE_WORKSPACE_DOMAIN`, `GOOGLE_CLIENT_ID`, `COUNSELOR_EMAILS`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `ALLOWED_ORIGINS` in the Render dashboard. Never commit secret values.
4. After Render provides the API URL, set `window.ANOCO_CALL_API` in `call-config.js` to that URL and push the change to `main` to publish it.
5. Counselors open `/AnoCO/staff.html`, sign in with an allowlisted school account, and stay online to receive calls. Verify audio, availability, and the hang-up flow using consenting staff/test accounts before inviting students.

The call queue and counselor presence currently live in one server process and disappear on restart; don't use this scaffold for a production student service until durable operational design, provider/privacy review, consent, retention, safeguarding, and incident response are approved.

The hero photograph and web fonts load from external providers and require an internet connection; the layout and form otherwise work locally.
