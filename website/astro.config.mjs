import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import starlightLinksValidator from 'starlight-links-validator'
import tailwindcss from '@tailwindcss/vite'
import sidebar from './src/sidebar.mjs'

export default defineConfig({
  site: 'https://ginutgeorge-aus.github.io',
  base: '/parishcrm',
  integrations: [
    starlight({
      title: 'ParishCRM',
      description: 'Free, self-hosted church management — families, accounting, events, receipts.',
      logo: { src: './src/assets/logo.svg', replacesTitle: false },
      favicon: '/favicon.svg',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/ginutgeorge-Aus/parishcrm' },
      ],
      editLink: {
        baseUrl: 'https://github.com/ginutgeorge-Aus/parishcrm/edit/main/website/',
      },
      customCss: ['./src/styles/starlight.css'],
      sidebar,
      plugins: [starlightLinksValidator()],
    }),
  ],
  vite: { plugins: [tailwindcss()] },
})
