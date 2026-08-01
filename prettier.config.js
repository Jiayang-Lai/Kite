/** @type {import("prettier").Config} */
const config = {
	useTabs: true,
	singleQuote: true,
	trailingComma: 'none',
	printWidth: 100,
	proseWrap: 'never',
	plugins: ['prettier-plugin-svelte', 'prettier-plugin-tailwindcss'],
	overrides: [
		{ files: '*.svelte', options: { parser: 'svelte' } },
		{ files: '.github/workflows/*.{yml,yaml}', options: { proseWrap: 'preserve' } }
	],
	tailwindStylesheet: './src/routes/layout.css'
};

export default config;
