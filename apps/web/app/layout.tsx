import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { Nav } from '@/components/Nav';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Observed',
    template: '%s — Observed',
  },
  description:
    'A reviewer agent that is not allowed to have an opinion until it has paid for evidence.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {/*
          Fonts are loaded with a plain <link> rather than next/font so that a
          font-CDN problem can never fail a production build. React 19 hoists
          these into <head>. The CSS declares full fallback stacks, so if the
          webfont never arrives the page still looks deliberate rather than
          broken.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;500&family=Inter:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />

        <Nav />

        <main className="shell" style={{ paddingBlock: 'var(--s7)' }}>
          {children}
        </main>

        <Footer />
      </body>
    </html>
  );
}
