import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layoutSource = readFileSync(
  new URL("../src/app/layout.tsx", import.meta.url),
  "utf8",
);
const cssSource = readFileSync(
  new URL("../src/app/board.css", import.meta.url),
  "utf8",
);

test("shared layout exposes exactly one maker contact footer", () => {
  assert.equal(
    (layoutSource.match(/data-maker-contact/g) ?? []).length,
    1,
  );
  assert.match(
    layoutSource,
    /<footer className="maker-contact" data-maker-contact="">\s*Built by\s*<a href="mailto:tangpingqingwa@gmail\.com">tangpingqingwa@gmail\.com<\/a>\s*<\/footer>/,
  );
});

test("maker contact uses restrained desk styling and remains keyboard-safe", () => {
  const makerCss = cssSource.slice(
    cssSource.indexOf("/* Identity: a quiet desk credit"),
  );

  assert.match(makerCss, /\.maker-contact\s*\{[\s\S]*?border-top:\s*1px dashed/);
  assert.match(makerCss, /font-family:\s*"IBM Plex Mono"/);
  assert.match(makerCss, /color:\s*var\(--manila\)/);
  assert.match(makerCss, /color:\s*var\(--stamp\)/);
  assert.match(makerCss, /\.maker-contact a:focus-visible[\s\S]*?outline:\s*2px solid var\(--stamp\)/);
  assert.match(makerCss, /overflow-wrap:\s*anywhere/);
  assert.match(makerCss, /@media \(max-width: 760px\)[\s\S]*?\.maker-contact/);
});
