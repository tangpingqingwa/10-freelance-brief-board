import type { Metadata } from "next";
import React, { type ReactNode } from "react";
import "./board.css";

export const metadata: Metadata = {
  title: "Freelance Brief Board",
  description:
    "Bid USD. Own the #1 brief this week. Rank is the bid. No invented ratings.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="site-header-inner">
            <a className="logo" href="/">
              freelance<span>.</span>briefs
            </a>
            <nav className="site-nav" aria-label="Main">
              <ul>
                <li>
                  <a href="/" aria-current="page">
                    Board
                  </a>
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
