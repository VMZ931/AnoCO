# AnoCo

A responsive mental wellbeing support concept for Grade 12 students. AnoCo helps students identify concerns like stress, anxiety, low mood, and relationship difficulties, then shape a question to bring to a trusted adult or school counselor.

## Run locally

Open `index.html` in a browser. This is a dependency-free static site; no install or build step is required.

## Publish with GitHub Pages

1. Create a GitHub repository named `AnoCo` and add the site files to its `main` branch.
2. Keep `.github/workflows/deploy-pages.yml` in the repository. It publishes the static site on each push to `main`.
3. In the repository, open **Settings > Pages** and select **GitHub Actions** as the build and deployment source if it is not selected automatically.
4. Open the **Actions** tab and wait for the `Publish AnoCo to GitHub Pages` workflow to finish. GitHub will show the published URL in the workflow run and Pages settings.

## Prototype and safety

This is not a counseling or crisis service. The form is intentionally frontend-only: its preview does not send, store, or share what a student writes, and no counselor will see it. Do not use the demo to collect real student information. Before offering real consultations, establish a documented privacy and safeguarding process and connect an appropriately secured intake system staffed by qualified people. For immediate danger, the page directs students to a trusted adult or local emergency services.

In-site voice calls are not active yet. They require an approved calling provider, a secure backend for call setup, and staffed counselor availability; GitHub Pages only hosts the static frontend.

The hero photograph and web fonts load from external providers and require an internet connection; the layout and form otherwise work locally.
