/** Span kinds validated by the backend `validate_spans_payload_schema`. */
export type SpanType = "narration" | "dialogue";

/** One segment of segmented prose with global character offsets. */
export interface Span {
  id: string;
  type: SpanType;
  text: string;
  start: number;
  end: number;
}

/** Payload shape accepted by deterministic span validators (M1 contract). */
export interface SpansPayload {
  source_id: string;
  chapter_id: string;
  text: string;
  spans: Span[];
}
