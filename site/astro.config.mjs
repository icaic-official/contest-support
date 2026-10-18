import {defineConfig} from 'astro/config';
import starlight from '@astrojs/starlight';
import {fileURLToPath, URL} from 'node:url';

export default defineConfig({
  site: 'https://minsky-docs.icaic-minsky.workers.dev',
  output: 'static',
  trailingSlash: 'always',
  vite: {
    server: {
      fs: {
        // Share the app's font without exposing the rest of its checkout.
        allow: [
          fileURLToPath(new URL('.', import.meta.url)),
          fileURLToPath(new URL('../public/fonts', import.meta.url)),
        ],
      },
    },
  },
  integrations: [starlight({
    title: 'Minsky docs',
    description: 'Guides for contest teams, support staff, and Minsky operators.',
    favicon: '/favicon.svg',
    customCss: ['./src/styles/custom.css'],
    social: [{
      icon: 'github',
      label: 'Minsky source',
      href: 'https://github.com/GiftedNovaHD/minsky',
    }],
    sidebar: [
      {label: 'Start here', items: [
        {label: 'Overview', slug: ''},
        {label: 'Sign in and get access', slug: 'guides/getting-started'},
        {label: 'Feature status', slug: 'reference/status'},
      ]},
      {label: 'Use Minsky', items: [
        {label: 'Contestants', slug: 'guides/contestants'},
        {label: 'Volunteers and specialists', slug: 'guides/staff'},
        {label: 'Jury and time awards', slug: 'guides/jury'},
        {label: 'Accounts and sessions', slug: 'guides/administration'},
      ]},
      {label: 'Operate an installation', items: [
        {label: 'Installation options', slug: 'operators/installation'},
        {label: 'Configure the backend', slug: 'operators/backend'},
        {label: 'Verify and maintain', slug: 'operators/verification'},
        {label: 'Troubleshooting', slug: 'operators/troubleshooting'},
      ]},
      {label: 'Contribute', items: [
        {label: 'Local development', slug: 'contributing/development'},
        {label: 'Write and deploy these docs', slug: 'contributing/documentation'},
      ]},
    ],
    head: [{tag: 'meta', attrs: {name: 'theme-color', content: '#143b36'}}],
  })],
});
