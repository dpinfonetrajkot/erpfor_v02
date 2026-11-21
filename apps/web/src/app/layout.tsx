import type { Metadata, Viewport } from 'next';
import { DM_Sans, Geist, Geist_Mono, IBM_Plex_Sans, Inter, Manrope, Nunito_Sans, Plus_Jakarta_Sans, Poppins } from 'next/font/google';
import { BRAND } from '@/lib/brand';
import { UI_CACHE_KEY } from '@/lib/appearance';
import { Providers } from './providers';
import './globals.css';

// The default font is preloaded; the others are downloaded only when someone picks them (Settings → Appearance).
const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap', preload: false });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap', preload: false });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap', preload: false });
const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-plex', display: 'swap', preload: false });
const dm = DM_Sans({ subsets: ['latin'], variable: '--font-dm', display: 'swap', preload: false });
const nunito = Nunito_Sans({ subsets: ['latin'], variable: '--font-nunito', display: 'swap', preload: false });
const poppins = Poppins({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-poppins', display: 'swap', preload: false });
const fontVars = [geist, geistMono, inter, jakarta, manrope, plex, dm, nunito, poppins].map((f) => f.variable).join(' ');

/** Puts the last used font / colour / size on <html> before the first paint (no flash of the default look). */
const earlyLook = `try{var u=JSON.parse(localStorage.getItem('${UI_CACHE_KEY}')||'{}'),d=document.documentElement;if(u.font)d.setAttribute('data-font',u.font);if(u.accent)d.setAttribute('data-accent',u.accent);if(u.textSize)d.setAttribute('data-size',u.textSize);}catch(e){}`;

export const metadata: Metadata = {
  title: { default: `${BRAND.short} ERP`, template: `%s · ${BRAND.short} ERP` },
  description: `${BRAND.name} - ${BRAND.product}`,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#e8ecf4' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1117' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={fontVars}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: earlyLook }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
