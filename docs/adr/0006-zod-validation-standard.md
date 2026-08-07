# Zod is the validation standard: response contracts are zod schemas in @kanjiscribe/shared, validated at the web's client seam

## Context

The api and web app are separate TypeScript packages with no shared type surface for API responses. Each side declares the response shapes by hand. The result is silent drift: the web app has declared the heatmap day shape five separate times with divergent fields (one declaration omits `estimated_total_ms` entirely), and nothing stops a web declaration from disagreeing with what the api actually serializes. A mismatch compiles cleanly and fails only at runtime, in the browser.

The api's actual responses are the source of truth — the server code is what produces the bytes. The web's declarations are approximations of those bytes, maintained by hand in parallel.

Zod is already the standing validation direction in this codebase: request parsing (`schemas.ts` in `@kanjiscribe/shared`, request-schema parsing at the api's HTTP seam) uses zod end to end. Request-side drift is caught; response-side drift is not.

## Decision

Adopt zod as the validation standard across api and web, for responses as well as requests:

- **Response contracts live in `@kanjiscribe/shared`.** `responses.ts` holds zod schemas for API response shapes, one per shape; each schema's inferred type (`z.infer`) is exported under a name drawn from CONTEXT.md vocabulary. Request schemas remain in `schemas.ts`.
- **The api annotates its returns with the inferred types.** Domain modules and route handlers declare their return type as the shared inferred type, so api-side drift (returning a field the contract doesn't declare, or vice versa) becomes a compile error at the source.
- **The web parses every response at its client seam.** `apiRequest` becomes `apiRequest(schema, path, options?)`: every response is parsed through the schema before it reaches consumer code, and a response that fails the schema rejects with an error naming the endpoint — never a silent pass-through.
- **The api's actual responses win disagreements.** When a hand-declared web type disagrees with the api's real response, the web declaration is unified onto the api's shape, not the other way around.

## Considered Options

- **A. Shared zod schemas + client-seam parse (chosen).** One source of truth for every response shape. The api side gets compile-time agreement via return annotations; the web side gets runtime agreement via `apiRequest` parsing. Drift on either side is caught at the earliest possible point — compile time on the api side, response time on the web side.
- **B. Shared plain TypeScript types, no runtime validation.** Fixes the api-side compile agreement but leaves the web's failure mode unchanged: a disagreement between the declared type and the real payload compiles cleanly and breaks at runtime. The heatmap-day drift that motivated this work happened exactly this way.
- **C. Keep per-app hand-declared types (status quo).** Two independent declarations of every shape, proven to drift (heatmap day declared five times with divergent fields) with no mechanism to notice.
- **D. Client-generated types from an OpenAPI/schema document.** Rejected as disproportionate: there is no schema document today, and a second generated-type pipeline would be a new dependency and build step for a codebase whose shapes are already enumerated in code.

## Consequences

- A response that fails its schema rejects the `apiRequest` promise with a useful error naming the endpoint and the zod issue — visible in the app's existing error paths, not swallowed.
- Every new or changed endpoint ships its response schema in `@kanjiscribe/shared` before the web consumes it; adding a field to a response means updating the schema, and the api's return annotation enforces the update.
- `apiRequest` now requires a schema as its first argument. Surfaces not yet covered by a shared response contract pass `z.custom<T>()` (typed pass-through) until their contract lands; those are replaced by real schemas as the response-contract slices roll out.
- The parse runs on every response, in every environment — the shapes are small and the cost is negligible against the network request it follows.
- Api-side return annotations are compile-time only: no runtime behavior of the api changes.
