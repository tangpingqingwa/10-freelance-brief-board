import { NextResponse } from "next/server";
import { assertProductionSettings } from "../../config";
import { assertDatabaseReady } from "../../db";

export const dynamic = "force-dynamic";
export const HEALTHZ_PATH = "/healthz" as const;

export type HealthzResponse =
  | { ok: true }
  | { ok: false; error: "not_ready" };

export function GET(): NextResponse<HealthzResponse> {
  try {
    if (process.env.NODE_ENV === "production") {
      assertDatabaseReady(process.env);
    } else {
      assertProductionSettings(process.env);
    }
  } catch {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { ok: false, error: "not_ready" } satisfies HealthzResponse,
        { status: 503 },
      );
    }
  }
  return NextResponse.json({ ok: true } satisfies HealthzResponse);
}
