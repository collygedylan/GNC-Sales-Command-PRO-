# AURA natural-language tools — separate release proposal

Status: proposal only. Release `.010` enables no inference or provider credentials.

## Flow

Transcript → authenticated AURA Edge handler → Gemini function selection → validated inventory/order tools → grounded response and cards.

Verify the active native session and exact Dylan profile before any provider call. Store the Gemini key in Edge Function secrets. The model selects a function and structured arguments; application code validates and executes them. See [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling).

## Tool contracts

| Tool | Bounded server operation |
| --- | --- |
| Match inventory | Reuse `.010` scoped name/size matching; at most five choices. |
| Count inventory | Exact SKU, allowed metric and scope; authoritative complete aggregate. |
| Maximum inventory | Aggregate eligible locations by SKU, preserving ties. |
| Lookup lots | Exact SKU and quantity, numeric priority ordering. |
| Lookup order | Authorized order identity and bounded status/line projection. |
| Prepare draft | Validate party and exact inventory rows; open the existing review form. |

Validate strict JSON schemas, lengths, allowed seasons and metrics. No raw SQL or unrestricted column parameters. Never expose service credentials to the model. Ambiguous identities require selection; order submission remains manual.

## Grounding and budgets

Send only necessary conversation context and bounded tool results. Build numerical speech and cards from verified results, preserving incomplete data, unknown values and ties. Do not transmit entire inventory catalogs or unrelated customer records.

Begin with at most two model rounds and five tool calls per command, short provider deadlines within an overall command budget, token caps, per-session limits and a daily spend limit. Provider failure, malformed arguments or exhausted budgets return the deterministic typed-command fallback. Do not retry writes automatically.

Diagnostics contain operation, correlation ID, duration, status and usage counts only. Exclude raw transcripts, customer details, message bodies and tool payloads.

## Separate approval and verification

Select a current Flash model at implementation time after checking availability and cost. Before enabling, test authorization denials, malicious arguments, ambiguous matches, incomplete quantities, provider failures, grounding and budget limits. No provider setup is included in `.010`.
