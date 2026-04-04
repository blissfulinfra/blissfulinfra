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
      description: 'Run a production-grade full-stack app locally with one command — Docker Compose, Kafka, Postgres, CI/CD, Prometheus, and an AI agent. Free to use.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/cavanpage/blissful-infra' },
        { icon: 'x.com', label: 'X', href: 'https://x.com/studiocavan' },
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
          attrs: { property: 'og:site_name', content: 'Blissful Infra' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:card', content: 'summary_large_image' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:site', content: '@studiocavan' },
        },
        {
          tag: 'meta',
          attrs: { name: 'twitter:image', content: 'https://blissful-infra.com/og.svg' },
        },
        {
          tag: 'script',
          attrs: { type: 'application/ld+json' },
          content: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'Blissful Infra',
            applicationCategory: 'DeveloperApplication',
            operatingSystem: 'macOS, Windows, Linux',
            description: 'Run a production-grade full-stack app locally with one command — Docker Compose, Kafka, Postgres, CI/CD, Prometheus, and an AI agent.',
            url: 'https://blissful-infra.com',
            downloadUrl: 'https://www.npmjs.com/package/@blissful-infra/cli',
            softwareVersion: '1.2.0',
            offers: [
              {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'USD',
                description: 'Local sandbox — free',
              },
              {
                '@type': 'Offer',
                price: '5',
                priceCurrency: 'USD',
                description: 'Hosted tier — $5/month',
              },
            ],
            author: {
              '@type': 'Person',
              name: 'Cavan Page',
              url: 'https://github.com/cavanpage',
            },
          }),
        },
      ],
      sidebar: [
        { label: 'Getting Started', link: '/getting-started' },
        { label: 'Pricing', link: '/pricing' },
        {
          label: 'Commands',
          items: [
            { label: 'start', link: '/commands/start' },
            { label: 'deploy', link: '/commands/deploy' },
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
        {
          label: 'Blog',
          items: [
            { label: 'Stop paying for cloud dev environments', link: '/blog/local-dev-environment' },
            { label: "A Developer's Guide to IAM", link: '/blog/iam-guide' },
          ],
        },
      ],
    }),
  ],
});
