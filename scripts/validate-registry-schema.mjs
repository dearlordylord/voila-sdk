#!/usr/bin/env node

import { readFileSync } from "node:fs"

import Ajv from "ajv"
import addFormats from "ajv-formats"

const serverJsonPath = "server.json"
const serverJson = JSON.parse(readFileSync(serverJsonPath, "utf-8"))
const schemaUrl = serverJson.$schema

if (typeof schemaUrl !== "string" || schemaUrl.length === 0) {
  console.error(`${serverJsonPath}: missing non-empty $schema`)
  process.exit(1)
}

let response

try {
  response = await fetch(schemaUrl, { signal: AbortSignal.timeout(15_000) })
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`${serverJsonPath}: failed to fetch schema ${schemaUrl}: ${message}`)
  process.exit(1)
}

if (!response.ok) {
  console.error(`${serverJsonPath}: failed to fetch schema ${schemaUrl}: ${response.status} ${response.statusText}`)
  process.exit(1)
}

const schema = await response.json()
const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)

const validate = ajv.compile(schema)

if (validate(serverJson)) {
  console.log(`${serverJsonPath} validates against ${schemaUrl}`)
  process.exit(0)
}

console.error(`${serverJsonPath} does not validate against ${schemaUrl}`)

for (const error of validate.errors ?? []) {
  console.error(`- ${error.instancePath || "/"} ${error.message ?? "failed validation"}`)
}

process.exit(1)
