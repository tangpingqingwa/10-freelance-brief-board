import type { Metadata } from "next";
import React, { type ReactNode } from "react";
import "./board.css";
import { FindPopover, ThemeToggle } from "./theme-toggle";

export const metadata: Metadata = {
  title: "Brief desk — the last 7 days’ #1 freelance brief",
  description:
    "Bid USD. Pin the last 7 days’ #1 job ticket. Rank is the bid, not the project budget. No invented ratings.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header" data-slot="site-header">
          <div className="site-header-inner" data-slot="shell">
            <a className="logo" href="/" aria-label="Brief desk home" data-slot="brand">
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
