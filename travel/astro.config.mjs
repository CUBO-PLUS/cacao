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

export default defineConfig({
  site: 'https://cacao-travel.vercel.app',
  trailingSlash: 'always',
  // Clerk signs in the operator panel and the header. The keys come from the environment, never from this file.
  integrations: [clerk({ localization: localizacion, appearance: apariencia })],
  // Pages are static. Only the booking and reader-discount routes run on the server.
  adapter: vercel(),
});
