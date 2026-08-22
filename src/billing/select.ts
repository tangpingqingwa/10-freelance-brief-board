import { FixturePaymentPort } from "./fixture";
import { PolarPaymentPort } from "./polar";
import {
  CheckoutError,
  polarAccessToken,
  polarLiveEnabled,
  type PaymentPort,
  type PolarEnv,
} from "./port";

let injectedPort: PaymentPort | undefined;
let defaultFixture: FixturePaymentPort | undefined;

export function setPaymentPort(port: PaymentPort | undefined): void {
  injectedPort = port;
}

export function resetPaymentPort(): void {
  injectedPort = undefined;
  defaultFixture = undefined;
}

export function getPaymentPort(env: PolarEnv = process.env): PaymentPort {
  if (injectedPort) return injectedPort;
  if (polarLiveEnabled(env)) {
    const token = polarAccessToken(env);
    if (!token) {
      throw new CheckoutError("polar_unavailable", 503);
    }
    return new PolarPaymentPort({ env });
  }
  if (!defaultFixture) {
    defaultFixture = new FixturePaymentPort();
  }
  return defaultFixture;
}

export function createPaymentPort(env: PolarEnv = process.env): PaymentPort {
  if (polarLiveEnabled(env)) {
    return new PolarPaymentPort({ env });
  }
  return new FixturePaymentPort();
}
