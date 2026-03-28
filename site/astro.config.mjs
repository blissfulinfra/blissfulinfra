import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://blissful-infra.com',
  output: 'static',
  integrations: [
    sitemap(),
    starlight({
      title: 'Blissful Infra',
      description: 'Full-stack infrastructure orchestration for modern development teams',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/cavanpage/blissful-infra' },
      ],
      customCss: ['./src/styles/custom.css'],
      head: [
        {
          tag: 'meta',
          attrs: { property: 'og:image', content: 'https://blissful-infra.com/og.svg' },
        },
        {
          tag: 'meta',
          attrs: { property: 'og:type', content: 'website' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:card', content: 'summary_large_image' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:image', content: 'https://blissful-infra.com/og.svg' },
        },
      ],
      sidebar: [
        { label: 'Getting Started', link: '/getting-started' },
        { label: 'Pricing', link: '/pricing' },
        {
          label: 'Commands',
          items: [
            { label: 'start', link: '/commands/start' },
            { label: 'dev', link: '/commands/dev' },
            { label: 'dashboard', link: '/commands/dashboard' },
            { label: 'jenkins', link: '/commands/jenkins' },
          ],
        },
        {
          label: 'Templates',
          items: [
            { label: 'Overview', link: '/templates/overview' },
            { label: 'Spring Boot', link: '/templates/spring-boot' },
            { label: 'React + Vite', link: '/templates/react-vite' },
          ],
        },
      ],
    }),
  ],
});
