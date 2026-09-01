"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type PaidSearchRow = {
  id: string;
  title: string;
  buyer: string;
  briefUrl: string;
  host: string;
  href: string;
  rank: string;
  bid: string;
  searchText: string;
};

type HeaderIconName = "search" | "moon";

/** Lucide's official stroke paths keep the compact header controls readable. */
function HeaderIcon({ name }: { name: HeaderIconName }) {
  const common = {
    className: "icon",
    width: 17,
    height: 17,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "search") {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function readPaidRows(): PaidSearchRow[] {
  const rows: PaidSearchRow[] = [];
  const seen = new Set<string>();

  document
    .querySelectorAll<HTMLElement>(
      ".ticket[data-listing-card][data-listing-id]",
    )
    .forEach((card) => {
      const id = card.dataset.listingId?.trim();
      if (!id || seen.has(id)) return;

      const buyer =
        card.dataset.buyer?.trim() ||
        card
          .querySelector<HTMLElement>("[data-buyer-name]")
          ?.textContent?.trim() ||
        "Paid brief";
      const briefLink = card.querySelector<HTMLAnchorElement>(
        "[data-brief-url]",
      );
      const briefUrl = briefLink?.dataset.briefUrl?.trim() || "";
      let host = "";
      try {
        host = new URL(briefUrl).host;
      } catch {
        host = "";
      }

      const title = buyer;
      const row: PaidSearchRow = {
        id,
        title,
        buyer,
        briefUrl,
        host,
        href: briefLink?.getAttribute("href") || `/click/${id}`,
        rank: card.dataset.rank || "",
        bid: card.dataset.bid ? `$${card.dataset.bid}` : "",
        searchText: [title, buyer, briefUrl, host].join(" ").toLowerCase(),
      };
      rows.push(row);
      seen.add(id);
    });

  return rows;
}

export function FindPopover() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<PaidSearchRow[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    const syncRows = () => setRows(readPaidRows());
    syncRows();

    const board = document.querySelector("[data-brief-desk]");
    const observer = board ? new MutationObserver(syncRows) : null;
    observer?.observe(board as Node, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "data-rank",
        "data-bid",
        "data-brief-url",
        "data-buyer",
      ],
    });

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }

    function handleOutsidePointer(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    }

    document.addEventListener("keydown", handleEscape);
    document.addEventListener("pointerdown", handleOutsidePointer);
    window.requestAnimationFrame(() => inputRef.current?.focus());

    return () => {
      observer?.disconnect();
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("pointerdown", handleOutsidePointer);
    };
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      normalizedQuery
        ? rows.filter((row) => row.searchText.includes(normalizedQuery))
        : [],
    [normalizedQuery, rows],
  );

  function closeAndRestoreFocus() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <div className="find-control" ref={rootRef}>
      <button
        type="button"
        className="header-search"
        aria-label="Find paid briefs"
        aria-expanded={open}
        aria-controls="find-popover"
        aria-haspopup="dialog"
        title="Find paid briefs"
        ref={triggerRef}
        onClick={() => {
          if (open) {
            closeAndRestoreFocus();
          } else {
            setOpen(true);
          }
        }}
      >
        <HeaderIcon name="search" />
        <span className="sr-only">Find</span>
      </button>

      {open ? (
        <form
          id="find-popover"
          className="find-popover"
          role="search"
          aria-label="Find paid briefs"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="find-popover-head">
            <label htmlFor="find-input">Find a paid brief</label>
            <button
              type="button"
              className="find-close"
              onClick={closeAndRestoreFocus}
            >
              Close
            </button>
          </div>
          <input
            ref={inputRef}
            id="find-input"
            className="find-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buyer, brief URL, or host"
            autoComplete="off"
            spellCheck={false}
          />

          {normalizedQuery ? (
            results.length > 0 ? (
              <ul className="find-results" aria-live="polite">
                {results.map((row) => (
                  <li
                    className="find-result"
                    key={row.id}
                    data-search-result-id={row.id}
                  >
                    <a
                      href={row.href}
                      className="find-result-link"
                      data-search-result-link=""
                      onClick={() => setOpen(false)}
                    >
                      <span className="find-result-title">{row.title}</span>
                      <span className="find-result-meta">
                        <span>Rank {row.rank}</span>
                        <span>Bid {row.bid}</span>
                        <span>{row.host || row.briefUrl}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="find-empty" role="status">
                No matching paid brief.
              </p>
            )
          ) : (
            <p className="find-hint">
              Search current paid briefs by buyer, brief URL, or host.
            </p>
          )}
        </form>
      ) : null}
    </div>
  );
}

/** A small client island keeps the document shell server-rendered. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  function toggleTheme() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    setDark(next);
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggleTheme}
    >
      <HeaderIcon name="moon" />
      <span className="sr-only">Theme</span>
    </button>
  );
}
