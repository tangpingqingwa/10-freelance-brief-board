import type { Metadata } from "next";
import React, { type ReactNode } from "react";
import "./board.css";
import { FindPopover, ThemeToggle } from "./theme-toggle";

const SITE_URL = "https://freelancebrief.lol";
const SITE_NAME = "Freelance Brief";
const SITE_DESCRIPTION =
  "Bid USD. Pin the last 7 days’ #1 job ticket. Rank is the bid, not the project budget. Find freelance briefs on a transparent rolling seven-day board.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Brief desk — the last 7 days’ #1 freelance brief", template: "%s | Freelance Brief" },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["freelance briefs", "freelance jobs", "project briefs", "independent work"],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/brand-mark.svg", type: "image/svg+xml" }],
    shortcut: "/brand-mark.svg",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: "Freelance Brief — Paid Job-Ticket Board",
    description: SITE_DESCRIPTION,
    images: [{ url: "/brand-mark.png", width: 512, height: 512, alt: "Freelance Brief job ticket" }],
  },
  twitter: {
    card: "summary",
    title: "Freelance Brief — Paid Job-Ticket Board",
    description: SITE_DESCRIPTION,
    images: ["/brand-mark.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  inLanguage: "en",
  isAccessibleForFree: true,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      </head>
      <body>
        <header className="site-header" data-slot="site-header">
          <div className="site-header-inner" data-slot="shell">
            <a className="logo" href="/" aria-label="Brief desk home" data-slot="brand">
              <img className="brand-mark" src="/brand-mark.svg" width="28" height="28" alt="" aria-hidden="true" />
              brief<span>desk</span>
            </a>
            <nav className="site-nav" aria-label="Main" data-slot="primary-nav">
              <ul>
                <li>
                  <a href="/" aria-current="page">
                    Desk
                  </a>
                </li>
                <li>
                  <a href="/about">About</a>
                </li>
                <li>
                  <a href="/rules">Rules</a>
                </li>
              </ul>
            </nav>
            <div className="header-actions">
              <FindPopover />
              <ThemeToggle />
            </div>
          </div>
        </header>
        {children}
        <footer className="maker-contact" data-maker-contact="">
          Built by <a href="mailto:tangpingqingwa@gmail.com">tangpingqingwa@gmail.com</a>
        </footer>
      </body>
    </html>
  );
}
