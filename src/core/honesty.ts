/** Reject invented ratings, stars, review scores, and hire-rate fields. */

export class HonestyError extends Error {
  constructor(
    readonly code: "rating_forbidden",
    readonly httpStatus = 400,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "HonestyError";
  }
}

const RATING_KEY =
  /^(stars?|rating|ratings|reviewScore|review_score|reviewCount|review_count|hireRate|hire_rate|reputation|topRated|top_rated)$/i;

export const INVENTED_RATING_COPY =
  /★|⭐|star rating|4\.8 stars|review score|top rated|hire rate/i;

export const INVENTED_RATING_MARKUP =
  /★|⭐|star rating|4\.8 stars|review score|top rated|hire rate|data-stars|data-rating/i;

export function isRatingFieldKey(key: string): boolean {
  return RATING_KEY.test(key);
}

export function isInventedRatingCopy(raw: string): boolean {
  return INVENTED_RATING_COPY.test(raw);
}

export function htmlHasInventedRatings(html: string): boolean {
  return INVENTED_RATING_MARKUP.test(html);
}

/** Submit path. Any rating field or star/review copy is rating_forbidden. */
export function rejectInventedRatings(body: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(body)) {
    if (isRatingFieldKey(key)) {
      throw new HonestyError("rating_forbidden");
    }
    if (typeof value === "string" && isInventedRatingCopy(value)) {
      throw new HonestyError("rating_forbidden");
    }
  }
}

export function assertHonestMarkup(html: string): void {
  if (htmlHasInventedRatings(html)) {
    throw new HonestyError("rating_forbidden");
  }
}
