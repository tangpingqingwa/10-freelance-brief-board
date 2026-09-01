/**
 * Compatibility import for old internal callers. The public/documented route
 * is `/checkout`; keeping this alias avoids breaking an already-rendered form
 * while all new UI, smoke, and tests use the canonical route.
 */
export { POST } from "../../checkout/route";
