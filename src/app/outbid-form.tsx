"use client";

import React, { useState } from "react";
import { MIN_BID_USD, parseWholeUsd } from "../core/money";
import { canonicalizeBriefUrl } from "../core/url";

type OutbidFormProps = {
  defaultAmount: number;
  occupied?: boolean;
  unpaidOff?: boolean;
};

function clampAmount(value: number): number {
  if (!Number.isFinite(value)) return MIN_BID_USD;
  return Math.max(MIN_BID_USD, Math.trunc(value));
}

export function isBriefUrlReady(value: string): boolean {
  if (!value.trim()) return false;
  try {
    canonicalizeBriefUrl(value);
    return true;
  } catch {
    return false;
  }
}

export function isProjectBudgetReady(value: string): boolean {
  const budgetUsd = parseWholeUsd(value);
  return budgetUsd !== undefined && budgetUsd >= 1;
}

type TicketField = "buyer" | "budgetUsd" | "deadline" | "winnerRule" | "briefUrl";

type TicketFieldValues = Record<TicketField, string>;

type ClaimReadiness = {
  ready: boolean;
  message: string;
};

type IconName = "chevron-down" | "minus" | "plus";

/**
 * Lucide's published stroke paths keep the controls legible without a text
 * symbol fallback.  The surrounding button still owns the accessible name.
 */
function Icon({ name }: { name: IconName }) {
  const common = {
    className: "icon",
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "minus") {
    return (
      <svg {...common}>
        <path d="M5 12h14" />
      </svg>
    );
  }
  if (name === "plus") {
    return (
      <svg {...common}>
        <path d="M5 12h14" />
        <path d="M12 5v14" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function TicketIdentityFields({
  values,
  onChange,
}: {
  values: TicketFieldValues;
  onChange: (field: TicketField, value: string) => void;
}) {
  return (
    <>
      <label className="ticket-row ticket-primary-field">
        <span className="field-label">
          Brief URL <span className="required-mark">Required</span>
        </span>
        <input
          name="briefUrl"
          type="text"
          required
          placeholder="client.com/brief"
          inputMode="url"
          autoComplete="url"
          data-slot="url-input"
          value={values.briefUrl}
          onChange={(event) => onChange("briefUrl", event.target.value)}
        />
      </label>

      <details className="ticket-details" open>
        <summary data-slot="ticket-details-control">
          <span className="field-label">
            Project ticket details
            <span className="required-mark">4 required</span>
          </span>
          <Icon name="chevron-down" />
        </summary>
        <div className="ticket-details-grid">
          <label>
            <span className="field-label">
              Who is buying <span className="required-mark">Required</span>
            </span>
            <input
              name="buyer"
              type="text"
              required
              maxLength={80}
              autoComplete="organization"
              placeholder="Company or person"
              value={values.buyer}
              onChange={(event) => onChange("buyer", event.target.value)}
            />
          </label>
          <label>
            <span className="field-label">
              What it pays <span className="required-mark">Required</span>
            </span>
            <input
              name="budgetUsd"
              type="text"
              required
              inputMode="numeric"
              pattern="[0-9]+"
              maxLength={16}
              placeholder="Whole USD, e.g. 2500"
              aria-describedby="project-budget-help"
              value={values.budgetUsd}
              onChange={(event) => onChange("budgetUsd", event.target.value)}
            />
            <span className="field-help" id="project-budget-help">
              Digits only — no $, commas, cents, or exponent notation.
            </span>
          </label>
          <label className="ticket-deadline-field">
            <span className="field-label">
              When it’s due <span className="required-mark">Required</span>
            </span>
            <input
              name="deadline"
              type="date"
              required
              value={values.deadline}
              onChange={(event) => onChange("deadline", event.target.value)}
            />
          </label>
          <label className="ticket-row">
            <span className="field-label">
              How a winner is chosen
              <span className="required-mark">Required</span>
            </span>
            <input
              name="winnerRule"
              type="text"
              required
              maxLength={280}
              placeholder="First qualified, fixed price…"
              value={values.winnerRule}
              onChange={(event) => onChange("winnerRule", event.target.value)}
            />
          </label>
        </div>
      </details>
    </>
  );
}

function TicketWrite({
  values,
  onChange,
  readiness,
}: {
  values: TicketFieldValues;
  onChange: (field: TicketField, value: string) => void;
  readiness: ClaimReadiness;
}) {
  return (
    <div className="claim-controls" data-slot="claim-controls">
      <div
        className="ticket-fields ticket-identity"
        id="claim-details"
        data-ticket-identity=""
      >
        <TicketIdentityFields values={values} onChange={onChange} />
      </div>
      <p
        className="claim-readiness"
        id="claim-readiness"
        data-ready={readiness.ready ? "true" : "false"}
        aria-live="polite"
      >
        {readiness.message}
      </p>
      <div className="bid-row">
        <button
          type="submit"
          className="outbid"
          data-slot="claim-button"
          aria-label="Claim rank"
          aria-describedby="claim-readiness"
          data-ready={readiness.ready ? "true" : "false"}
        >
          Claim rank
        </button>
      </div>
    </div>
  );
}

function getClaimReadiness(values: TicketFieldValues): ClaimReadiness {
  if (!isBriefUrlReady(values.briefUrl)) {
    return {
      ready: false,
      message: "Enter a public brief URL, such as client.com/brief.",
    };
  }
  const buyer = values.buyer.trim();
  if (!buyer) {
    return {
      ready: false,
      message: "Add who is buying to complete this required ticket.",
    };
  }
  if (buyer.length > 80) {
    return {
      ready: false,
      message: "Who is buying must be 80 characters or fewer.",
    };
  }
  if (!isProjectBudgetReady(values.budgetUsd)) {
    return {
      ready: false,
      message: "Enter the project budget as whole-dollar digits only, for example 2500.",
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.deadline)) {
    return {
      ready: false,
      message: "Choose the required project deadline.",
    };
  }
  const winnerRule = values.winnerRule.trim();
  if (!winnerRule) {
    return { ready: false, message: "Explain how the winner will be chosen." };
  }
  if (winnerRule.length > 280) {
    return {
      ready: false,
      message: "The winner rule must be 280 characters or fewer.",
    };
  }
  return {
    ready: true,
    message: "Ready for checkout. Payment confirmation is what places this ticket.",
  };
}

export function OutbidForm({
  defaultAmount,
  occupied = false,
  unpaidOff = false,
}: OutbidFormProps) {
  const [amount, setAmount] = useState(() => clampAmount(defaultAmount));
  const [values, setValues] = useState<TicketFieldValues>({
    buyer: "",
    budgetUsd: "",
    deadline: "",
    winnerRule: "",
    briefUrl: "",
  });

  function bump(delta: number) {
    setAmount((current) => clampAmount(current + delta));
  }

  function updateField(field: TicketField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  const readiness = getClaimReadiness(values);

  return (
    <section
      className={
        occupied
          ? "claim ticket-blank occupied-claim"
          : "claim ticket-blank"
      }
      id="claim"
      data-write-ticket={occupied ? "buyer" : undefined}
      data-empty-ticket={occupied ? undefined : ""}
      data-slot="claim-surface"
      aria-label={occupied ? "Write this ticket" : "Claim #1"}
    >
      <h2
        data-empty-claim={occupied ? undefined : ""}
        data-slot="claim-heading"
      >
        <span>Claim #1 for</span>
        <span className="amount-stepper">
          <button
            type="button"
            className="step"
            aria-label="Decrease bid by one dollar"
            onClick={() => bump(-1)}
          >
            <Icon name="minus" />
          </button>
          <label className="amount-field">
            <span className="sr-only">Amount in whole US dollars</span>
            $
            <input
              name="amountUsd"
              form="brief-outbid-form"
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
            <Icon name="plus" />
          </button>
        </span>
      </h2>
      <form
        id="brief-outbid-form"
        className="outbid-form"
        method="post"
        action="/checkout"
        data-bid-form=""
        data-ticket-form=""
        data-slot="claim-form"
      >
        <div className="ticket-write-stub" aria-hidden="true">
          Write
        </div>
        <div className="ticket-write-face">
          <p className="ticket-serial">New job ticket</p>
          <p
            className="claim-note"
            data-unpaid-off={unpaidOff ? "" : undefined}
          >
            New tickets start at ${MIN_BID_USD}. Paying less than #1 still lists
            at the rank that bid can take. Rank is the bid, not the project
            budget. Unpaid checkout stays off this desk until payment is confirmed. An abandoned ticket is not #1.
          </p>
          <TicketWrite
            values={values}
            onChange={updateField}
            readiness={readiness}
          />
        </div>
      </form>
    </section>
  );
}
