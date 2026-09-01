import ReturnPage from "../../return/page";

// Waffo's configured success URL lands here. This page is deliberately the
// same read-only durable-state view as /return; query parameters never settle
// a payment or create a listing.
export const dynamic = "force-dynamic";

export default ReturnPage;
