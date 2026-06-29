import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { describe, expect, it } from "vitest"

type FixtureEntry = {
  readonly contents: string
  readonly path: string
}

const makeFixtureDirectory = (entries: ReadonlyArray<FixtureEntry>) => {
  const directory = mkdtempSync(join(tmpdir(), "voila-fixture-audit-"))

  for (const entry of entries) {
    const filePath = join(directory, entry.path)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, entry.contents)
  }

  return directory
}

const runFixtureAudit = (directory: string) =>
  spawnSync(process.execPath, ["scripts/audit-fixtures.mjs", directory], {
    cwd: process.cwd(),
    encoding: "utf8"
  })

describe("fixture audit script", () => {
  it("accepts public product identifiers and sanitized sensitive placeholders", () => {
    const directory = makeFixtureDirectory([{
      contents: JSON.stringify({
        nextPageToken: "sanitized-next-page-token",
        products: [{
          retailerProductId: "12345"
        }]
      }),
      path: "safe.json"
    }])

    const result = runFixtureAudit(directory)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Fixture audit passed")
  })

  it("rejects unsanitized sensitive fields embedded in HTML fixtures", () => {
    const directory = makeFixtureDirectory([{
      contents: `<script>
window.__INITIAL_STATE__ = {
  "csrf": {
    "token":
      "real-csrf-value"
  }
}
</script>`,
      path: "homepage.html"
    }])

    const result = runFixtureAudit(directory)

    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain("field \"token\" must contain a sanitized placeholder value")
  })

  it("rejects documented session, auth, and destination identifiers", () => {
    const directory = makeFixtureDirectory([{
      contents: JSON.stringify({
        Authorization: "Bearer raw-auth-header",
        checkoutCorrelationId: 12345,
        deliveryDestinationId: "destination-123",
        destinationId: "destination-456",
        orderId: "order-123",
        sessionId: "session-123"
      }),
      path: "account.json"
    }])

    const result = runFixtureAudit(directory)

    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain("sanitized placeholder value")
  })

  it("rejects parsed cookie-entry-like fixture shapes", () => {
    const directory = makeFixtureDirectory([{
      contents: JSON.stringify([{
        domain: "voila.ca",
        key: "voila-session",
        path: "/",
        value: "raw-cookie-value"
      }]),
      path: "cookies.json"
    }])

    const result = runFixtureAudit(directory)

    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain("cookie-entry-like object")
  })

  it("rejects embedded HTML cookie-entry-like fixture shapes", () => {
    const directory = makeFixtureDirectory([{
      contents: `<script>
window.__INITIAL_STATE__ = {
  "jar": [{
    "key": "voila-session",
    "value": "raw-cookie-value",
    "domain": "voila.ca",
    "path": "/"
  }]
}
</script>`,
      path: "homepage.html"
    }])

    const result = runFixtureAudit(directory)

    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain("cookie-entry-like object")
  })

  it("rejects embedded HTML non-string sensitive identifiers", () => {
    const directory = makeFixtureDirectory([{
      contents: `<script>
window.__INITIAL_STATE__ = {
  "customerAccountId": 12345,
  "addressId": 67890
}
</script>`,
      path: "homepage.html"
    }])

    const result = runFixtureAudit(directory)

    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain("must use a sanitized string placeholder value")
  })

  it("scans nested fixture directories", () => {
    const directory = makeFixtureDirectory([{
      contents: JSON.stringify({
        token: "raw-nested-token"
      }),
      path: "nested/raw.json"
    }])

    const result = runFixtureAudit(directory)

    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain("nested/raw.json")
  })
})
