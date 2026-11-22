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

This is not a counseling or crisis service. The message form and counselor inbox are implemented, but submissions are disabled by default. To enable them, configure `MESSAGE_INTAKE_ENABLED=true` and an explicitly approved `MESSAGE_RETENTION_HOURS` value from 1 to 720 on the backend. Counselor sign-in must also be configured. Messages are held only in server memory, are automatically deleted after the configured cumulative time while at least one counselor is online or manually by a counselor, and are lost if the service restarts; they are not linked to calls. The retention timer pauses while no counselor is online. This is not durable storage and must not be used for real student intake until the school approves this limitation and the documented privacy, safeguarding, monitoring, retention, and provider-handling process. See the [message-intake policy draft](docs/message-intake-policy-draft.md). For immediate danger, the page directs students to a trusted adult or local emergency services.

## In-site audio calls

The call UI uses LiveKit for audio and a Node API for short-lived room tokens. Counselors sign in with Google Identity; the API checks both the configured Workspace domain and an explicit counselor email allowlist. The browser never receives the LiveKit API secret. Student identities and room names are random, microphone-only, and held in memory; AnoCo does not record audio or written previews. LiveKit processes call audio to connect participants.

Calls are not ready for real student use until the school has approved the provider and safeguarding process, configured the accounts below, tested the queue with staff, and provided an always-on backend. The included Render free plan is for setup/testing only: its in-memory counselor presence and call queue are lost on restart, and free services may sleep.

1. Create an approved LiveKit Cloud project and keep its API secret private.
2. In Google Cloud, create a Web OAuth client for `https://vmz931.github.io`; configure the school's Workspace domain and the exact counselor email allowlist.
3. Connect this repository to Render using `render.yaml`. Set `GOOGLE_WORKSPACE_DOMAIN`, `GOOGLE_CLIENT_ID`, `COUNSELOR_EMAILS`, `COUNSELOR_ADMIN_EMAILS`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `ALLOWED_ORIGINS` in the Render dashboard. `COUNSELOR_ADMIN_EMAILS` is a comma-separated list of trusted school staff who can add counselors in the console; these accounts can also receive calls. Counselor sign-in and roster management can work before LiveKit is configured; audio calls remain unavailable until all call settings are present. Message intake is separately disabled by default. Do not enable it for real student use with the current in-memory store. Never commit secret values.
4. `call-config.js` already points to the current Render API. If you replace the service, update `window.ANOCO_CALL_API` and push the change to `main`.
5. Students can open `/AnoCO/calls.html` directly or use the call link on the homepage. Counselors open `/AnoCO/staff.html`, sign in with an allowlisted school account, and stay online to receive calls. A configured counselor administrator can add school-domain accounts from the console. Added accounts are held only in server memory and are lost on service restart; add them to `COUNSELOR_EMAILS` in Render to keep them across restarts. Verify audio, availability, and the hang-up flow using consenting staff/test accounts before inviting students.

The call queue and counselor presence currently live in one server process and disappear on restart; don't use this scaffold for a production student service until durable operational design, provider/privacy review, consent, retention, safeguarding, and incident response are approved.

The counselor message inbox uses the same allowlisted Google counselor authentication as the call console. Students can submit a topic, message, and optional name, email address, phone number, and grade or section. Counselors can refresh and delete messages. Messages are automatically removed after `MESSAGE_RETENTION_HOURS` of cumulative time while at least one counselor is online; the timer pauses when no counselor is online. Messages are also lost whenever the server restarts or sleeps. Inbox messages are independent of audio calls and are not deleted when a call ends. The inbox is a prototype, not a durable or monitored service; use a school-approved durable store and operational process before collecting real student contact information.

The hero photograph and web fonts load from external providers and require an internet connection; the layout and form otherwise work locally.
