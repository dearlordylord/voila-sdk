# Fixture Refresh Workflow

Voila fixtures are sanitized examples of live web-app responses. They are safe to commit only after all session, account, address, and payment-bearing data has been replaced with explicit `sanitized-*` placeholders.

## Refresh Steps

1. Capture live responses only in an ignored location such as `.reference/fixture-refresh/` or outside the repository.
2. Use the existing opt-in live smoke scripts where possible:

   ```bash
   VOILA_LIVE_SMOKE=1 pnpm smoke:catalog-search
   VOILA_LIVE_SMOKE=1 pnpm smoke:cart
   VOILA_AUTH_SMOKE=1 VOILA_AUTH_SESSION_PATH=/absolute/path/to/sdk-session.json pnpm smoke:auth-readonly
   ```

3. Copy only the minimum response shape needed by the test into `test/fixtures/`.
4. Replace sensitive values with deterministic placeholders:
   - cookies, CSRF tokens, session IDs, and auth headers -> `sanitized-*`
   - customer, account, visitor, destination, and address IDs -> `sanitized-*`
   - names, emails, phones, postal codes, street addresses, delivery notes -> `sanitized-*`
   - payment methods, card details, checkout identifiers tied to an account -> `sanitized-*`
5. Keep product names, public product IDs, prices, availability, and generic status fields only when they are not account-specific.
6. Run the fixture audit before committing:

   ```bash
   pnpm fixtures:audit
   pnpm check-all
   ```

If the audit flags a fixture, sanitize the fixture. Do not weaken the audit to make a raw capture pass.

## Audit Coverage

`pnpm fixtures:audit` scans committed `.json` and `.html` files in `test/fixtures/`. It rejects raw-looking cookies, CSRF tokens, addresses, postal codes, phone numbers, emails, payment terms, and unapproved sensitive key names. Approved sensitive fixture keys are allowed only when their string values contain a `sanitized-*` placeholder.

Raw captures must never be committed. `.reference/` and environment files are ignored for local capture material, but ignored files are still sensitive and should be deleted when the fixture update is finished.
