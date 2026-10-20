import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import clerk from '@clerk/astro';
import { esMX } from '@clerk/localizations/es-MX';

// Clerk strings: the es-MX base, with the voseo lines of El Salvador on top.
const localizacion = {
  ...esMX,
  signIn: {
    ...esMX.signIn,
    start: {
      ...esMX.signIn.start,
      title: 'Entrá a tu cuenta',
      titleCombined: 'Entrá a tu cuenta',
      actionText: '¿No tenés cuenta?',
      actionLink: 'Registrate',
    },
  },
  signUp: {
    ...esMX.signUp,
    start: {
      ...esMX.signUp.start,
      title: 'Creá tu cuenta',
      titleCombined: 'Creá tu cuenta',
      actionText: '¿Ya tenés cuenta?',
      actionLink: 'Iniciá sesión',
    },
  },
};

// Same palette as the site styles: chocolate for buttons and links, tostado for text.
const apariencia = {
  variables: {
    colorPrimary: '#5a3221',
    colorText: '#2a1912',
    colorBackground: '#fffaf4',
    fontFamily: "'Bricolage Grotesque Variable', 'Bricolage Grotesque', system-ui, sans-serif",
  },
  // A flat card with a thin border, like the other cards of the site.
  elements: {
    cardBox: { boxShadow: 'none', border: '1px solid rgba(42, 25, 18, 0.14)', borderRadius: '16px' },
    card: { boxShadow: 'none' },
  },
};
import { unified } from '@astrojs/markdown-remark';
import { rehypeGate } from './src/lib/rehype-gate.mjs';

export default defineConfig({
  site: 'https://cacao-media.vercel.app',
  trailingSlash: 'always',
  // Clerk signs in the admin panel and the header. The keys come from the environment, never from this file.
  integrations: [clerk({ localization: localizacion, appearance: apariencia })],
  // Pages are static. Only the routes that sign or check tokens (src/pages/api) run on the server.
  adapter: vercel(),
  vite: {
    server: {
      // The other sites and scratch folders live in this repository too. A file written there
      // (a screenshot, a build) must not reload this site while someone is using it.
      watch: { ignored: ['**/.qa/**', '**/market/**', '**/pay/**', '**/ledger/**', '**/travel/**'] },
    },
  },
  markdown: {
    // 'quitar': the text after <!-- gate --> is left out of the page. See scripts/cerrado.mjs.
    processor: unified({ rehypePlugins: [[rehypeGate, { modo: 'quitar' }]] }),
  },
});
