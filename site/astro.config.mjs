import {defineConfig} from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://minsky-docs.icaic-minsky.workers.dev',
  output: 'static',
  trailingSlash: 'always',
  integrations: [starlight({
    title: 'Minsky',
    description: 'Guides for contest teams, support staff, and Minsky operators.',
    favicon: '/favicon.svg',
    logo: {light: './src/assets/logo-light.svg', dark: './src/assets/logo-dark.svg'},
    customCss: [
      '@fontsource-variable/inter',
      '@fontsource-variable/jetbrains-mono',
      './src/styles/custom.css',
    ],
    expressiveCode: {
      themes: ['github-dark-default', 'github-light-default'],
      styleOverrides: {
        borderRadius: '0.5rem',
        borderColor: 'var(--sl-color-hairline)',
        codeFontFamily: 'var(--sl-font-mono)',
        frames: {shadowColor: 'transparent'},
      },
    },
    social: [{
      icon: 'github',
      label: 'Minsky source',
      href: 'https://github.com/GiftedNovaHD/minsky',
    }],
    sidebar: [
      {label: 'Start here', items: [
        {label: 'Overview', slug: ''},
        {label: 'Sign in', slug: 'guides/getting-started'},
        {label: 'Feature status', slug: 'reference/status'},
      ]},
      {label: 'Use Minsky', items: [
        {label: 'Contestants', slug: 'guides/contestants'},
        {label: 'Volunteers and specialists', slug: 'guides/staff'},
        {label: 'Jury', slug: 'guides/jury'},
        {label: 'Announcements', slug: 'guides/announcements'},
        {label: 'Contest admins', slug: 'guides/administration'},
        {label: 'Event admins', slug: 'guides/event-admin'},
        {label: 'Webmasters', slug: 'guides/webmaster'},
      ]},
      {label: 'Operate', items: [
        {label: 'Install Cloudflare', slug: 'operators/installation'},
        {label: 'Verify and upgrade', slug: 'operators/verification'},
        {label: 'Troubleshooting', slug: 'operators/troubleshooting'},
      ]},
      {label: 'Contribute', items: [
        {label: 'Local development', slug: 'contributing/development'},
        {label: 'Write these docs', slug: 'contributing/documentation'},
      ]},
    ],
    head: [
      {tag: 'meta', attrs: {name: 'theme-color', content: '#ffffff', media: '(prefers-color-scheme: light)'}},
      {tag: 'meta', attrs: {name: 'theme-color', content: '#09090b', media: '(prefers-color-scheme: dark)'}},
    ],
  })],
});
