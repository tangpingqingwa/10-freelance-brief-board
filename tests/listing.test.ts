import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { POST as checkoutPost } from "../src/app/checkout/route";
import { resetPaymentPort } from "../src/billing/select";
import { CheckoutError, parseCheckoutInput } from "../src/billing/port";
import { ListingError, canonicalBriefUrl } from "../src/core/listing";
import { getBoardListings } from "../src/core/rank";
import { resetListings } from "../src/core/listings";
import {
  canonicalizeBriefUrl,
  isTrackingQueryKey,
  UrlError,
} from "../src/core/url";
import { currentWeekUtc } from "../src/core/week";

afterEach(() => {
  resetListings();
  resetPaymentPort();
});

const WEEK = currentWeekUtc().weekId;

function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    buyer: "Acme Studio",
    budgetUsd: "3200",
    deadline: "2026-09-15",
    winnerRule: "Best portfolio by Friday",
    briefUrl: "https://example.com/acme",
    amountUsd: "5",
    weekId: WEEK,
    ...overrides,
  };
}

async function postJson(payload: Record<string, unknown>): Promise<Response> {
  return checkoutPost(
    new Request("http://localhost/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
    }),
  );
}

test("listing requires buyer, budget, deadline, and brief URL", () => {
  assert.throws(
    () => parseCheckoutInput(draft({ buyer: "" })),
    (err: unknown) => {
      assert.ok(err instanceof CheckoutError);
      assert.equal(err.code, "invalid_listing");
      return true;
    },
  );
  assert.throws(
    () => parseCheckoutInput(draft({ budgetUsd: "12.50" })),
    (err: unknown) => {
      assert.ok(err instanceof CheckoutError);
      assert.equal(err.code, "budget_not_whole");
      return true;
    },
  );
  assert.throws(
    () => parseCheckoutInput(draft({ deadline: "soon" })),
    (err: unknown) => {
      assert.ok(err instanceof CheckoutError);
      assert.equal(err.code, "deadline_invalid");
      return true;
    },
  );
  assert.throws(
    () => parseCheckoutInput(draft({ briefUrl: "" })),
    (err: unknown) => {
      assert.ok(err instanceof CheckoutError);
      assert.equal(err.code, "url_insecure");
      return true;
    },
  );
  const input = parseCheckoutInput(draft());
  assert.equal(input.listingDraft.buyer, "Acme Studio");
  assert.equal(input.listingDraft.budgetUsd, 3200);
  assert.equal(input.listingDraft.deadline, "2026-09-15");
  assert.equal(input.listingDraft.briefUrl, "https://example.com/acme");
});

test("utm_source and tracking keys are stripped from the stored brief URL", () => {
  assert.equal(isTrackingQueryKey("utm_source"), true);
  assert.equal(isTrackingQueryKey("utm_campaign"), true);
  assert.equal(isTrackingQueryKey("fbclid"), true);
  assert.equal(isTrackingQueryKey("ref_src"), true);
  assert.equal(isTrackingQueryKey("keep"), false);

  const stripped = canonicalizeBriefUrl(
    "https://Briefs.Example/job?utm_source=x&utm_campaign=launch&fbclid=1&gclid=2&gbraid=3&wbraid=4&msclkid=5&ref=ad&ref_src=tw&affiliate=1&aff=2&irclickid=9&mc_cid=a&mc_eid=b&icid=c&si=d&igshid=e&keep=yes#frag",
  );
  assert.equal(stripped, "https://briefs.example/job?keep=yes");
  assert.doesNotMatch(stripped, /utm_/);
  assert.doesNotMatch(stripped, /fbclid/);
  assert.doesNotMatch(stripped, /#/);

  const input = parseCheckoutInput(
    draft({
      briefUrl: "https://example.com/acme?utm_source=board&fbclid=abc#top",
    }),
  );
  assert.equal(input.listingDraft.briefUrl, "https://example.com/acme");
  assert.equal(
    canonicalBriefUrl("https://example.com/acme?utm_source=x"),
    "https://example.com/acme",
  );
});

test("bare brief domains default to HTTPS before checkout and storage", () => {
  assert.equal(
    canonicalizeBriefUrl("Briefs.Example/client-brief"),
    "https://briefs.example/client-brief",
  );
  assert.equal(
    canonicalizeBriefUrl("//Briefs.Example/client-brief"),
    "https://briefs.example/client-brief",
  );

  const input = parseCheckoutInput(
    draft({ briefUrl: "client.example:8443/brief" }),
  );
  assert.equal(
    input.listingDraft.briefUrl,
    "https://client.example:8443/brief",
  );
});

test("bare private, link-local, and local brief targets remain forbidden", () => {
  for (const briefUrl of [
    "10.0.0.1/brief",
    "172.16.0.1/brief",
    "192.168.0.1/brief",
    "[fe80::1]/brief",
    "[fc00::1]/brief",
    "[fd12:3456::1]/brief",
    "[::ffff:127.0.0.1]/brief",
    "[::ffff:10.0.0.1]/brief",
    "localhost/brief",
  ]) {
    assert.throws(() => canonicalizeBriefUrl(briefUrl), (err: unknown) => {
      assert.ok(err instanceof UrlError);
      assert.equal(err.code, "url_forbidden");
      return true;
    });
  }
});

test("brief URL grammar rejects path-only, slash, backslash, and obfuscated inputs", () => {
  const rejected = [
    "/path",
    "///example.com/brief",
    "////example.com/brief",
    "//\\evil.com",
    "//evil.com\\path",
    "\\path",
    "\\\\example.com",
    "/\\example.com",
    "\\/example.com",
    "example.com\\brief",
    "https:\\\\example.com/brief",
    "https://example.com\\brief",
    "https://brief.example.com/%5cbrief",
    "java\nscript:123",
    "data\t:123",
    "java%73cript:123",
    "javascript\\:123",
  ];
  for (const briefUrl of rejected) {
    assert.throws(() => canonicalizeBriefUrl(briefUrl), (err: unknown) => {
      assert.ok(err instanceof UrlError);
      assert.ok(err.code === "url_insecure" || err.code === "url_forbidden");
      return true;
    });
    assert.throws(
      () => parseCheckoutInput(draft({ briefUrl })),
      (err: unknown) => {
        assert.ok(err instanceof CheckoutError);
        assert.ok(err.code === "url_insecure" || err.code === "url_forbidden");
        return true;
      },
    );
  }

  assert.equal(
    canonicalizeBriefUrl("https://brief.example.com/brief"),
    "https://brief.example.com/brief",
  );
  assert.equal(
    canonicalizeBriefUrl("//brief.example.com/brief"),
    "https://brief.example.com/brief",
  );
  assert.equal(
    canonicalizeBriefUrl("brief.example.com/brief"),
    "https://brief.example.com/brief",
  );
  assert.equal(
    canonicalizeBriefUrl("brief.example.com:8443/brief"),
    "https://brief.example.com:8443/brief",
  );
});

test("telegram invite is url_forbidden", () => {
  for (const briefUrl of [
    "https://t.me/foo",
    "https://telegram.me/invite",
    "https://wa.me/15555550100",
    "https://chat.whatsapp.com/invite",
    "https://discord.gg/abc",
    "https://discord.com/invite/abc",
    "https://m.me/page",
    "https://signal.me/#p/+15555550100",
  ]) {
    assert.throws(() => canonicalizeBriefUrl(briefUrl), (err: unknown) => {
      assert.ok(err instanceof UrlError);
      assert.equal(err.code, "url_forbidden");
      return true;
    });
    assert.throws(
      () => canonicalBriefUrl(briefUrl),
      (err: unknown) => {
        assert.ok(err instanceof ListingError);
        assert.equal(err.code, "url_forbidden");
        return true;
      },
    );
  }
});

test("NSFW brief URL is url_forbidden", () => {
  for (const briefUrl of [
    "https://pornhub.com/view",
    "https://onlyfans.com/user",
    "https://example.com/nsfw/brief",
    "https://example.com/xxx",
  ]) {
    assert.throws(() => canonicalizeBriefUrl(briefUrl), (err: unknown) => {
      assert.ok(err instanceof UrlError);
      assert.equal(err.code, "url_forbidden");
      return true;
    });
  }
});

test("http, javascript, data, shortener, and localhost are rejected", () => {
  assert.throws(() => canonicalizeBriefUrl("http://example.com/insecure"), (err: unknown) => {
    assert.ok(err instanceof UrlError);
    assert.equal(err.code, "url_insecure");
    return true;
  });
  for (const briefUrl of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "https://bit.ly/abc",
    "https://t.co/abc",
    "https://tinyurl.com/abc",
    "https://lnkd.in/abc",
    "https://localhost/brief",
    "https://127.0.0.1/brief",
    "https://user:pass@example.com/brief",
  ]) {
    assert.throws(() => canonicalizeBriefUrl(briefUrl), (err: unknown) => {
      assert.ok(err instanceof UrlError);
      assert.ok(err.code === "url_insecure" || err.code === "url_forbidden");
      return true;
    });
  }
});

test("numeric javascript and data schemes are not treated as host ports", () => {
  for (const briefUrl of ["javascript:123", "data:123"]) {
    assert.throws(() => canonicalizeBriefUrl(briefUrl), (err: unknown) => {
      assert.ok(err instanceof UrlError);
      assert.equal(err.code, "url_forbidden");
      return true;
    });
  }
});

test("denylisted hosts stay forbidden with repeated trailing dots", () => {
  for (const briefUrl of [
    "https://t.me../foo",
    "https://bit.ly.../abc",
    "https://pornhub.com.../view",
    "https://onlyfans.com../user",
  ]) {
    assert.throws(() => canonicalizeBriefUrl(briefUrl), (err: unknown) => {
      assert.ok(err instanceof UrlError);
      assert.equal(err.code, "url_forbidden");
      return true;
    });
  }
});

test("checkout rejects chat, NSFW, and invented ratings without listing", async () => {
  const chat = await postJson(draft({ briefUrl: "https://t.me/foo" }));
  assert.equal(chat.status, 400);
  assert.deepEqual(await chat.json(), { error: "url_forbidden" });

  const nsfw = await postJson(draft({ briefUrl: "https://pornhub.com/view" }));
  assert.equal(nsfw.status, 400);
  assert.deepEqual(await nsfw.json(), { error: "url_forbidden" });

  const rating = await postJson(draft({ rating: "4.8" }));
  assert.equal(rating.status, 400);
  assert.deepEqual(await rating.json(), { error: "rating_forbidden" });
  assert.equal(getBoardListings().length, 0);
});
