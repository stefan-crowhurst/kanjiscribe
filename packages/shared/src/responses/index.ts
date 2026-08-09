/**
 * Response contract schemas (see ADR-0006). The inferred types name the
 * response shapes; the api annotates route returns with them (api-side drift
 * becomes a compile error) and the web's `apiRequest` parses every response
 * through them (web-side drift becomes a runtime rejection).
 *
 * Split by surface, mirroring the api's area directories: assignments,
 * dictionary, estimates, intake, stats — plus the error body every non-2xx
 * response shares.
 */
export * from './assignments.js';
export * from './dictionary.js';
export * from './error.js';
export * from './estimates.js';
export * from './intake.js';
export * from './stats.js';
