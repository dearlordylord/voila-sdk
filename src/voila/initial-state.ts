import type { ParseResult } from "effect"
import { Either } from "effect"

import { parseJson, parseUnknown } from "../domain/parse.js"
import { type InitialState, InitialStateSchema } from "../domain/schemas/index.js"

const initialStateMarker = "window.__INITIAL_STATE__"
const assignmentToken = "="
const scriptOpenStart = "<script"
const scriptOpenEnd = ">"
const scriptClose = "</script>"
const objectStart = "{"
const objectEnd = "}"
const quote = "\""
const escape = "\\"
const missingIndex = -1
const whitespaceCharacters = new Set([" ", "\n", "\r", "\t"])

export type InitialStateExtractionError =
  | {
    readonly _tag: "InitialStateScriptMissing"
    readonly marker: string
  }
  | {
    readonly _tag: "InitialStateJsonMissing"
    readonly marker: string
  }
  | {
    readonly _tag: "InitialStateJsonMalformed"
    readonly cause: Error
  }
  | {
    readonly _tag: "InitialStateSchemaMismatch"
    readonly cause: ParseResult.ParseError
  }

const scriptMissing = (): InitialStateExtractionError => ({
  _tag: "InitialStateScriptMissing",
  marker: initialStateMarker
})

const jsonMissing = (): InitialStateExtractionError => ({
  _tag: "InitialStateJsonMissing",
  marker: initialStateMarker
})

const jsonMalformed = (cause: Error): InitialStateExtractionError => ({
  _tag: "InitialStateJsonMalformed",
  cause
})

const schemaMismatch = (cause: ParseResult.ParseError): InitialStateExtractionError => ({
  _tag: "InitialStateSchemaMismatch",
  cause
})

const skipWhitespace = (html: string, fromIndex: number): number => {
  let index = fromIndex

  while (index < html.length && whitespaceCharacters.has(html.charAt(index))) {
    index += 1
  }

  return index
}

const findJsonStart = (html: string, fromIndex: number): number => {
  const assignmentIndex = skipWhitespace(html, fromIndex)

  if (html[assignmentIndex] !== assignmentToken) {
    return missingIndex
  }

  const objectIndex = skipWhitespace(html, assignmentIndex + assignmentToken.length)

  if (html[objectIndex] !== objectStart) {
    return missingIndex
  }

  return objectIndex
}

const findJsonEnd = (html: string, fromIndex: number): number => {
  let depth = 0
  let index = fromIndex
  let inString = false
  let escaped = false

  while (index < html.length) {
    const character = html[index]

    if (escaped) {
      escaped = false
    } else if (character === escape) {
      escaped = inString
    } else if (character === quote) {
      inString = !inString
    } else if (!inString && character === objectStart) {
      depth += 1
    } else if (!inString && character === objectEnd) {
      depth -= 1

      if (depth === 0) {
        return index
      }
    }

    index += 1
  }

  return missingIndex
}

const findInitialStateScript = (html: string): Either.Either<string, InitialStateExtractionError> => {
  let searchIndex = 0

  while (searchIndex < html.length) {
    const openStartIndex = html.indexOf(scriptOpenStart, searchIndex)

    if (openStartIndex < 0) {
      return Either.left(scriptMissing())
    }

    const openEndIndex = html.indexOf(scriptOpenEnd, openStartIndex + scriptOpenStart.length)

    if (openEndIndex < 0) {
      return Either.left(scriptMissing())
    }

    const closeIndex = html.indexOf(scriptClose, openEndIndex + scriptOpenEnd.length)

    if (closeIndex < 0) {
      return Either.left(scriptMissing())
    }

    const scriptBody = html.slice(openEndIndex + scriptOpenEnd.length, closeIndex)

    if (scriptBody.includes(initialStateMarker)) {
      return Either.right(scriptBody)
    }

    searchIndex = closeIndex + scriptClose.length
  }

  return Either.left(scriptMissing())
}

const extractInitialStateJson = (html: string): Either.Either<string, InitialStateExtractionError> => {
  return Either.flatMap(findInitialStateScript(html), (scriptBody) => {
    const markerIndex = scriptBody.indexOf(initialStateMarker)

    const jsonStart = findJsonStart(scriptBody, markerIndex + initialStateMarker.length)

    if (jsonStart < 0) {
      return Either.left(jsonMissing())
    }

    const jsonEnd = findJsonEnd(scriptBody, jsonStart)

    if (jsonEnd < 0) {
      return Either.left(jsonMissing())
    }

    return Either.right(scriptBody.slice(jsonStart, jsonEnd + 1))
  })
}

export const extractInitialStatePayload = (html: string): Either.Either<unknown, InitialStateExtractionError> =>
  Either.flatMap(
    extractInitialStateJson(html),
    (json) => Either.mapLeft(parseJson(json), jsonMalformed)
  )

export const extractInitialState = (html: string): Either.Either<InitialState, InitialStateExtractionError> =>
  Either.flatMap(
    extractInitialStatePayload(html),
    (payload) => Either.mapLeft(parseUnknown(InitialStateSchema, payload), schemaMismatch)
  )
