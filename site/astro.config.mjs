import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Blissful Infra',
      description: 'Full-stack infrastructure orchestration for modern development teams',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/cavanpage/blissful-infra' },
      ],
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        { label: 'Getting Started', link: '/getting-started' },
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
