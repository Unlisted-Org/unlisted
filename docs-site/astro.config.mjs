// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	integrations: [
		starlight({
			title: 'Unlisted Docs',
			description:
				'A basket of seven tokenized pre-IPO companies on Solana that still pays out when the issuer acts: how it works, what it proves, and how to check it yourself. Devnet only.',
			logo: {
				light: './src/assets/mark-light.svg',
				dark: './src/assets/mark-dark.svg',
				alt: 'Unlisted',
			},
			favicon: '/favicon.svg',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/Unlisted-Org/unlisted' }],
			customCss: [
				'@fontsource/ibm-plex-sans/400.css',
				'@fontsource/ibm-plex-sans/500.css',
				'@fontsource/ibm-plex-sans/600.css',
				'@fontsource/ibm-plex-sans-condensed/500.css',
				'@fontsource/ibm-plex-sans-condensed/600.css',
				'@fontsource/ibm-plex-mono/400.css',
				'./src/styles/theme.css',
			],
			components: {
				ThemeProvider: './src/components/ThemeProvider.astro',
				ThemeSelect: './src/components/ThemeSelect.astro',
			},
			sidebar: [
				{
					label: 'Start here',
					items: [
						{ label: 'Introduction', slug: 'index' },
						{ label: 'Getting started', slug: 'start/getting-started' },
					],
				},
				{
					label: 'The product',
					items: [
						{ label: 'The problem', slug: 'product/problem' },
						{ label: 'How it works', slug: 'product/how-it-works' },
						{ label: 'Core concepts', slug: 'product/concepts' },
						{ label: 'The user flow', slug: 'product/user-flow' },
					],
				},
				{
					label: 'The protocol',
					items: [
						{ label: 'The protocol flow', slug: 'protocol/flow' },
						{ label: 'Claims and settlement', slug: 'protocol/claims' },
						{ label: 'Architecture', slug: 'protocol/architecture' },
						{ label: 'The program', slug: 'protocol/program' },
					],
				},
				{
					label: 'Trust',
					items: [
						{ label: 'Security and assumptions', slug: 'trust/security' },
						{ label: 'Evidence', slug: 'trust/evidence' },
						{ label: 'FAQ', slug: 'trust/faq' },
					],
				},
			],
		}),
	],
});
