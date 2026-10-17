---
title: Write and deploy these docs
description: Edit Markdown, check the generated site, and deploy only the documentation Worker.
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

## 5. Confirm the Cloudflare target

The docs configuration is `wrangler.docs.jsonc`.
Its Worker name is `minsky-docs`.
Its account ID is `458ad6a930b0fb717796dfa19ca6a2b1`, the existing Minsky development account.
Its asset directory is `site/dist`.

```sh
npx wrangler whoami
npx wrangler deploy --config wrangler.docs.jsonc --dry-run
```

If you need to authenticate, run `npm run cloud:hosting-login` and complete Cloudflare login in your browser.
Compare the reported account with the docs configuration before deployment.
Never put a Cloudflare token in a Markdown page or frontend environment variable.

## 6. Deploy the reviewed docs

After the source checks pass and deployment is authorized:

```sh
npm run docs:deploy
```

This rebuilds the docs and deploys only `minsky-docs`.
The site address is `https://minsky-docs.icaic-minsky.workers.dev`.
The root `npm run deploy` command deploys the Minsky application instead.
Do not use that command for a documentation update.

The first docs deployment is explicitly authorized with T0011, before its source PR is merged.
Future updates follow the usual review, merge, and explicit deployment process.
There is no automatic deployment on merge.

## 7. Check the published result

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
