"use client";

import React, { useState, type FormEvent } from "react";
import { MIN_BID_USD } from "../core/rank";

type OutbidFormProps = {
  defaultAmount: number;
};

function clampAmount(value: number): number {
  if (!Number.isFinite(value)) return MIN_BID_USD;
  return Math.max(MIN_BID_USD, Math.trunc(value));
}

export function OutbidForm({ defaultAmount }: OutbidFormProps) {
  const [amount, setAmount] = useState(() => clampAmount(defaultAmount));
  const [notice, setNotice] = useState<string | null>(null);

  function bump(delta: number) {
    setAmount((current) => clampAmount(current + delta));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // Unpaid stub: no Polar in this PR. Submitting must not invent a listing.
    event.preventDefault();
    setNotice("Checkout is not live. No charge and no rank claimed.");
  }

  return (
    <section className="claim" id="claim">
      <form
        className="outbid-form"
        method="post"
        action="/"
        onSubmit={onSubmit}
        data-bid-form=""
      >
        <h2>
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
          New briefs start at ${MIN_BID_USD}. Paying less than #1 still lists at
          the rank that bid can take. Rank is the bid, not the project budget.
        </p>
        <div className="fields">
          <label>
            Buyer
            <input
              name="buyer"
              type="text"
              required
              maxLength={80}
              autoComplete="organization"
              placeholder="Company or person"
            />
          </label>
          <label>
            Budget (USD)
            <input
              name="budgetUsd"
              type="number"
              required
              min={1}
              step={1}
              inputMode="numeric"
              placeholder="Project budget"
            />
          </label>
          <label>
            Deadline
            <input name="deadline" type="date" required />
          </label>
          <label className="wide">
            How the winner is chosen
            <input
              name="winnerRule"
              type="text"
              required
              maxLength={280}
              placeholder="Portfolio, first qualified, fixed price…"
            />
          </label>
          <label className="wide">
            Brief URL
            <input
              name="briefUrl"
              type="url"
              required
              placeholder="https://"
              autoComplete="url"
            />
          </label>
        </div>
        <div className="bid-row">
          <button type="submit" className="outbid">
            Outbid
          </button>
        </div>
        <p className="raise-hint">
          Already on this week? Enter the same brief URL and raise. Raise pays
          the difference only after checkout lands.
        </p>
        {notice ? (
          <p className="stub-note" data-checkout-stub="">
            {notice}
          </p>
        ) : null}
      </form>
    </section>
  );
}
