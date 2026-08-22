# Freelance Brief Board

Weekly public auction for the #1 freelance brief so designers, developers, and editors see the demand first. Buyers (US/EU) pay USD. Rank is the bid. Budget, deadline, and how the winner is chosen are public. No invented ratings.

Build contract: [SPEC.md](./SPEC.md).
How we build: [BUILD.md](./BUILD.md).
How we work: [CONTRIBUTING.md](./CONTRIBUTING.md). `main` stays buildable and testable.

Clone of [outbid.lol](https://outbid.lol/) mechanics: USD whole dollars, min $5, older wins ties, raise pays the difference, Polar + fixture.

```bash
bash scripts/test.sh
```

Offline until a later PR adds the app. Live Polar is never required to keep `main` green.
