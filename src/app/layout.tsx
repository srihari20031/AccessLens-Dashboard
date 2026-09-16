import type { Metadata } from 'next';

import { SiteHeader } from '@/components/SiteHeader';

/*
  IBM Plex, in its sans and mono cuts. One voice, two widths.

  The dashboard's content is machine output — criteria numbers, CSS selectors, HTML snippets,
  hashes — so a mono face is load-bearing rather than decorative, and Plex Mono is the same
  design as Plex Sans rather than an unrelated face borrowed for texture.

  Self-hosted from npm (@fontsource) rather than fetched through `next/font/google`: the font
  files then come out of node_modules at build time, so a machine that cannot reach
  fonts.gstatic.com still builds, and no request leaves the reader's browser for a third party.
  Only the latin subset and the three weights actually used are imported.
*/
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';

import './globals.css';
import { WCAG_TARGET } from '@/lib/wcag';

export const metadata: Metadata = {
  title: { default: 'AccessLens', template: '%s — AccessLens' },
  description:
    `Read and compare AccessLens ${WCAG_TARGET} conformance reports. Severity bands, never a score.`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" tabIndex={-1}>
          <div className="shell">{children}</div>
        </main>
        <footer className="site-footer">
          <div className="shell">
            <p className="prose">
              AccessLens reports what its automated checks found. Findings that need a human
              decision are listed as such and are never counted as failures. No result here is a
              statement that a page conforms to {WCAG_TARGET}.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
