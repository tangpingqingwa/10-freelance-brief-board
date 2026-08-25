import type { Metadata } from "next";
import React, { type ReactNode } from "react";
import "./board.css";

export const metadata: Metadata = {
  title: "Brief desk — the last 7 days’ #1 freelance brief",
  description:
    "Bid USD. Pin the last 7 days’ #1 job ticket. Rank is the bid, not the project budget. No invented ratings.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <a className="logo" href="/">
              brief<span>desk</span>
            </a>
            <nav className="site-nav" aria-label="Main">
              <ul>
                <li>
                  <a href="/">Desk</a>
                </li>
                <li>
                  <a href="/about">About</a>
                </li>
                <li>
                  <a href="/rules">Rules</a>
                </li>
              </ul>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
