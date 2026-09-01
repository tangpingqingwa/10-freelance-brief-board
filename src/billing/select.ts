import { assertProviderSettings, providerMode, type ProviderMode } from "../config";
import { FixturePaymentPort } from "./fixture";
import { WaffoPaymentPort } from "./waffo";
import { CheckoutError, type PaymentEnv, type PaymentPort } from "./port";

let injectedPort: PaymentPort | undefined;
let defaultPort: PaymentPort | undefined;
let defaultMode: ProviderMode | undefined;

/** Tests may inject a fully controlled port; production cannot infer one. */
export function setPaymentPort(port: PaymentPort | undefined): void {
  if (port && process.env.NODE_ENV === "production") {
    throw new Error("BLOCKED-CONFIG: production cannot inject a payment port");
  }
  injectedPort = port;
}

export function resetPaymentPort(): void {
  if (process.env.NODE_ENV === "production" && (injectedPort || defaultPort)) {
    throw new Error("BLOCKED-CONFIG: production cannot reset payment ports");
  }
  injectedPort?.close?.();
  defaultPort?.close?.();
  injectedPort = undefined;
  defaultPort = undefined;
  defaultMode = undefined;
}

export function getPaymentPort(env: PaymentEnv = process.env): PaymentPort {
  // An injected port is the explicit test seam. It may be used with a
  // test-local environment that has no production selector, while a real
  // production process still has to pass the fail-closed validation.
  if (injectedPort) {
    if (env.NODE_ENV === "production" || process.env.NODE_ENV === "production") {
      throw new CheckoutError("payment_provider_injection_forbidden", 503);
    }
    return injectedPort;
  }
  const mode = chooseMode(env);
  if (!defaultPort || defaultMode !== mode) {
    defaultPort = makePort(mode, env);
    defaultMode = mode;
  }
  return defaultPort;
}

export function createPaymentPort(env: PaymentEnv = process.env): PaymentPort {
  return makePort(chooseMode(env), env);
}

function chooseMode(env: PaymentEnv): ProviderMode {
  const mode = providerMode(env);
  if (env.NODE_ENV === "production" || process.env.NODE_ENV === "production") {
    // This validates the entire production boundary before any port is
    // constructed; in particular, a fixture flag cannot bypass it.
    assertProviderSettings(env);
  }
  if (!mode) {
    throw new CheckoutError("payment_provider_unconfigured", 503);
  }
  return mode;
}

function makePort(mode: ProviderMode, env: PaymentEnv): PaymentPort {
  if (mode === "fixture") return new FixturePaymentPort();
  // Legacy provider variables/adapters are deliberately not consulted here.
  // A WAFFO_LIVE flag without an explicit mode is also refused by chooseMode.
  return new WaffoPaymentPort({ env });
}
