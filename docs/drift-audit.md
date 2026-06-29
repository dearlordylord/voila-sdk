# Endpoint Drift Audit

The endpoint drift audit is an opt-in live check for the unauthenticated endpoints that the SDK depends on most:

- guest homepage bootstrap and initial-state decoding
- catalog search response decoding
- guest cart read response decoding

Run it explicitly:

```bash
VOILA_DRIFT_AUDIT=1 pnpm drift:audit
```

Without `VOILA_DRIFT_AUDIT=1`, the script exits successfully and prints a skip message. Default gates, including `pnpm check-all`, never run this script and never hit Voila.

The audit does not add items, remove items, reserve slots, checkout, save cookies, or write session snapshots. It creates an in-memory guest session and reports only counts or typed failure tags.

## Reading Failures

Failures are printed as JSON with an operation name:

```json
{"_tag":"EndpointDriftAuditOperationFailed","operation":"catalog-search","causeTag":"VoilaSchemaDecodeFailure"}
```

Use the `operation` field to identify the endpoint family that drifted:

- `guest-bootstrap`: homepage HTML, initial state, cookies, CSRF, session metadata
- `catalog-search`: search request/response schema
- `cart-read`: cart view request/response schema

Use `causeTag` to decide the likely next action:

- `VoilaSchemaDecodeFailure` or `GuestBootstrapInitialStateMalformed`: Voila changed a response shape; refresh sanitized fixtures and update Effect schemas.
- `VoilaMalformedJson`: Voila returned non-JSON or changed an endpoint response type.
- `VoilaNon2xxResponse` or `GuestBootstrapNon2xxResponse`: endpoint path, headers, region, or request assumptions may have changed.
- `VoilaUnauthorizedSession`: session/cookie handling or guest access assumptions may have changed.
- `VoilaNetworkFailure` or `GuestBootstrapNetworkFailure`: retry later before changing schemas.

`EndpointDriftAuditNoProducts` means the harmless query returned zero products. Retry with another stable grocery query before treating it as schema drift.
