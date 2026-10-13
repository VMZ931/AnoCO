# AnoCo

A responsive, anonymous consultation website concept for Grade 12 students. AnoCo helps students choose a topic and draft a question about university, scholarships, school stress, career decisions, or something else.

## Run locally

Open `index.html` in a browser. This is a dependency-free static site; no install or build step is required.

## Publish with GitHub Pages

1. Create a GitHub repository named `AnoCo` and add the site files to its `main` branch.
2. Keep `.github/workflows/deploy-pages.yml` in the repository. It publishes the static site on each push to `main`.
3. In the repository, open **Settings > Pages** and select **GitHub Actions** as the build and deployment source if it is not selected automatically.
4. Open the **Actions** tab and wait for the `Publish AnoCo to GitHub Pages` workflow to finish. GitHub will show the published URL in the workflow run and Pages settings.

## Prototype privacy

The consultation form is intentionally frontend-only. Submitting it displays a local confirmation but does not send or store the question or optional email. Do not use this demo to collect real student information. Before launch, connect an appropriately secured backend and establish a clear privacy and safeguarding process. The form is not monitored for urgent support.

The hero photograph and web fonts load from external providers and require an internet connection; the layout and form otherwise work locally.
