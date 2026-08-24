"use client";

import React, { useState } from "react";
import { MIN_BID_USD } from "../core/rank";

type OutbidFormProps = {
  defaultAmount: number;
  occupied?: boolean;
};

function clampAmount(value: number): number {
  if (!Number.isFinite(value)) return MIN_BID_USD;
  return Math.max(MIN_BID_USD, Math.trunc(value));
}

function TicketIdentityFields() {
  return (
    <>
      <label className="ticket-row">
        Who is buying
        <input
          name="buyer"
          type="text"
          required
          maxLength={80}
          autoComplete="organization"
          placeholder="Company or person"
        />
      </label>
      <div className="ticket-pair">
        <label>
          What it pays
          <input
            name="budgetUsd"
            type="number"
            required
            min={1}
            step={1}
            inputMode="numeric"
            placeholder="Project budget, USD"
          />
        </label>
        <label>
          When it’s due
          <input name="deadline" type="date" required />
        </label>
      </div>
      <label className="ticket-row">
        How a winner is chosen
        <input
          name="winnerRule"
          type="text"
          required
          maxLength={280}
          placeholder="First qualified, fixed price…"
        />
      </label>
      <label className="ticket-row">
        Brief URL
        <input
          name="briefUrl"
          type="url"
          required
          placeholder="https://"
          autoComplete="url"
        />
      </label>
    </>
  );
}

function OccupiedTicketWrite() {
  return (
    <>
      <div className="ticket-fields">
        <TicketIdentityFields />
      </div>
      <div className="bid-row">
        <button type="submit" className="outbid">
          Outbid
        </button>
      </div>
    </>
  );
}

function EmptyClaimFirstWrite() {
  return (
    <>
      <div className="bid-row">
        <button type="submit" className="outbid" data-first-click="claim">
          Outbid
        </button>
      </div>
      <div
        className="ticket-fields ticket-identity"
        data-ticket-identity=""
        data-later-write=""
      >
        <p className="later-write-label">Then the brief URL</p>
        <TicketIdentityFields />
      </div>
    </>
  );
}

export function OutbidForm({
  defaultAmount,
  occupied = false,
}: OutbidFormProps) {
  const [amount, setAmount] = useState(() => clampAmount(defaultAmount));

  function bump(delta: number) {
    setAmount((current) => clampAmount(current + delta));
  }

  return (
    <section
      className={
        occupied
          ? "claim ticket-blank write-later"
          : "claim ticket-blank empty-claim-first"
      }
      id="claim"
      data-write-ticket={occupied ? "buyer" : undefined}
      data-write-later={occupied ? "" : undefined}
      data-empty-ticket={occupied ? undefined : ""}
      data-empty-claim-first={occupied ? undefined : ""}
      aria-label={occupied ? "Write this ticket" : "Claim #1"}
    >
      <form
        className="outbid-form"
        method="post"
        action="/api/checkout"
        data-bid-form=""
        data-ticket-form=""
      >
        <div className="ticket-write-stub" aria-hidden="true">
          Write
        </div>
        <div className="ticket-write-face">
          <p className="ticket-serial">New job ticket</p>
          {occupied ? (
            <p
              className="write-this-ticket"
              data-write-ticket-stamp=""
              data-write-later-quiet=""
            >
              Write this ticket
            </p>
          ) : null}
          <h2 data-empty-claim={occupied ? undefined : ""}>
            <span>Claim #1 for</span>
            <span className="amount-stepper">
              <button
                type="button"
                className="step"
                aria-label="Decrease bid by one dollar"
                onClick={() => bump(-1)}
              >
                −
              </button>
              <label className="amount-field">
                <span className="sr-only">Amount in whole US dollars</span>
                $
                <input
                  name="amountUsd"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={MIN_BID_USD}
                  step={1}
                  value={amount}
                  onChange={(event) => {
                    const next = Number(event.target.value.replace(/[^\d]/g, ""));
                    setAmount(clampAmount(next || MIN_BID_USD));
                  }}
                />
              </label>
              <button
                type="button"
                className="step"
                aria-label="Increase bid by one dollar"
                onClick={() => bump(1)}
              >
                +
              </button>
            </span>
          </h2>
          <p className="claim-note">
            New tickets start at ${MIN_BID_USD}. Paying less than #1 still lists
            at the rank that bid can take. Rank is the bid, not the project
            budget.
          </p>
          {occupied ? <OccupiedTicketWrite /> : <EmptyClaimFirstWrite />}
          <p className="raise-hint">
            Already on this week? Enter the same brief URL and raise. Raise pays
            the difference only after checkout lands.
          </p>
        </div>
      </form>
    </section>
  );
}
