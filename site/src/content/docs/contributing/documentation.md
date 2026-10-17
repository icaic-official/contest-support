---
title: Write and deploy these docs
description: Edit Markdown, check the generated site, and submit a documentation change.
---

The docs use Astro Starlight to turn Markdown files into a static website.
Cloudflare Workers Static Assets serves the generated files.
Search runs in the browser using a generated index.
The docs do not need a Supabase connection or account login.

## 1. Install the tools

Use Node.js 22.22 or later.
From the repository root:

```sh
npm ci
npm ci --prefix site
```

The site has its own package manifest and lockfile under `site/`.
This keeps its build dependencies separate from the application's dependencies.

## 2. Write a page

Pages live in `site/src/content/docs/`.
Use a Markdown file with a title and description:

```md
---
title: Your page title
description: The task this page helps the reader complete.
---

## Before you start

State the required access and the intended environment.

## Complete the task

1. Write the first action.
2. State the expected result.
```

Add the page to the sidebar in `site/astro.config.mjs`.
Use short sentences and exact interface labels.
Label planned features and unverified steps explicitly.
Link to the relevant guide instead of copying its instructions into another page.
Keep dated feature status in `reference/status.md`.

Only pages in the site's content directory are published.
The repository's internal ticket history and local environment files are not site inputs.

## 3. Preview while writing

```sh
npm run docs:dev
```

Open the local address printed by Astro.
The page refreshes when you save a file.
The full search index is available after a production build.

## 4. Verify the built site

```sh
npm run docs:build
npm run docs:test
```

The build generates `site/dist/` and checks local links and heading anchors.
The browser checks cover navigation, search, phone layout, and a missing page.
To inspect the build yourself:

```sh
npm run docs:preview
```

Check the page at a phone width and with the keyboard.
Check any new commands against the source revision they describe.
The repository CI also builds and checks the site.

## 5. Submit the documentation change

Push your branch and open a pull request.
Wait for `checks`, `secrets`, and `dependencies` to pass.
Ask a maintainer to review the content and the generated site.

After account setup, repository branch pushes publish app and docs previews when CI passes.
Open the docs preview URL in the push run's summary.
Fork pull requests run checks without deployment credentials and do not publish previews.
The user reviews and merges. A passing `main` run then updates the stable sites.

For activation or manual recovery, follow the repository's `docs/cloudflare-builds.md` guide.
The first automatic deployments remain unverified.

## 6. Check the published result

Open the returned URL.
Open an inner page directly and refresh it.
Search for a documented topic.
Open a nonexistent path and check that it returns the docs 404 page.
Run the same read-only browser checks against the published docs:

```sh
MINSKY_DOCS_URL=https://minsky-docs.icaic-minsky.workers.dev npm run docs:test
```

These checks read documentation only. They do not create contest records.
Record the source revision, Worker version, URL, and observed checks in `docs/current-state.md`.

Cloudflare supports a custom domain later if the project selects one.
The current address requires no purchased domain.
See [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) and [Starlight authoring](https://starlight.astro.build/guides/authoring-content/) for the upstream tools.
