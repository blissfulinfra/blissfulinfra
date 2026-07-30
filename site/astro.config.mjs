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
      description: 'An enterprise sandbox on your laptop. Real Kafka, real Postgres, real observability and real CI, wired together by one command. For engineers who want to iterate on architecture patterns without a cloud bill.',
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
            description: 'Run a production-grade full-stack app locally with one command — Docker Compose, Kafka, Postgres, local Kubernetes with ArgoCD and canary deploys, CI/CD, Prometheus, and an AI agent.',
            url: 'https://blissful-infra.com',
            downloadUrl: 'https://www.npmjs.com/package/@blissful-infra/cli',
            softwareVersion: '1.2.0',
            offers: [
              {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'USD',
                description: 'Free and open source',
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
        {
          label: 'Choose your path',
          items: [
            { label: 'Start here', link: '/paths/start-here' },
            { label: 'Build', link: '/paths/build' },
            { label: 'Learn', link: '/paths/learn' },
            { label: 'Deliver', link: '/paths/deliver' },
          ],
        },
        { label: 'Why I built this', link: '/about' },
        { label: 'Philosophy', link: '/philosophy' },
        {
          label: 'Guides',
          items: [
            { label: 'The tenant model', link: '/guides/tenant-model' },
            { label: 'The golden path (Kubernetes)', link: '/guides/golden-path' },
            { label: 'The compose runtime', link: '/guides/compose-runtime' },
          ],
        },
        {
          label: 'Commands',
          items: [
            { label: 'init', link: '/commands/init' },
            { label: 'use', link: '/commands/use' },
            { label: 'tenant', link: '/commands/tenant' },
            { label: 'project', link: '/commands/project' },
            { label: 'service', link: '/commands/service' },
            { label: 'status', link: '/commands/status' },
            { label: 'cluster', link: '/commands/cluster' },
            { label: 'deploy', link: '/commands/deploy' },
            { label: 'canary', link: '/commands/canary' },
            { label: 'rollback', link: '/commands/rollback' },
            { label: 'pipeline', link: '/commands/pipeline' },
            { label: 'jenkins', link: '/commands/jenkins' },
            { label: 'dashboard', link: '/commands/dashboard' },
            { label: 'mcp', link: '/commands/mcp' },
          ],
        },
        {
          label: 'Templates',
          items: [
            { label: 'Overview', link: '/templates/overview' },
            { label: 'Spring Boot', link: '/templates/spring-boot' },
            { label: 'Hono', link: '/templates/hono' },
            { label: 'React + Vite', link: '/templates/react-vite' },
            { label: 'Lambda (Python)', link: '/templates/lambda-python' },
          ],
        },
        {
          label: 'Blog',
          items: [
            { label: 'Stop paying for cloud dev environments', link: '/blog/local-dev-environment' },
            { label: "Learn AWS for free with LocalStack", link: '/blog/localstack-aws-locally' },
            { label: "A Developer's Guide to IAM", link: '/blog/iam-guide' },
          ],
        },
      ],
    }),
  ],
});
