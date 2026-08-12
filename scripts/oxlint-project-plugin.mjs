const report = (context, node, message) => {
  context.report({ node, message })
}

const memberName = (node) => {
  if (node.computed && node.property.type === "Literal") return node.property.value
  if (node.property.type === "Identifier") return node.property.name
  return undefined
}

const isIdentifier = (node, name) => node?.type === "Identifier" && node.name === name

const naturalKeyCollator = new Intl.Collator("en", { numeric: true })

const patternKey = (node) => {
  if (node.type === "RestElement") return { name: node.argument.name, order: 99 }
  if (node.type !== "Property" || node.computed) return undefined
  if (node.key.type === "Identifier") return { name: node.key.name, order: 1 }
  if (node.key.type === "Literal") return { name: String(node.key.value), order: 1 }
  return undefined
}

const containsIdentifier = (node, names) => {
  if (node === null || typeof node !== "object") return false
  if (node.type === "Identifier" && names.has(node.name)) return true

  return Object.entries(node).some(([key, value]) => {
    if (key === "parent" || key === "range" || key === "loc") return false
    if (Array.isArray(value)) return value.some((entry) => containsIdentifier(entry, names))
    return containsIdentifier(value, names)
  })
}

const sortablePattern = (node) => {
  const keys = node.properties.map(patternKey)
  if (keys.some((key) => key === undefined)) return undefined

  const boundNames = new Set(keys.map((key) => key.name))
  const orderSensitive = node.properties.some(
    (property) =>
      property.type === "Property" &&
      property.value.type === "AssignmentPattern" &&
      containsIdentifier(property.value.right, boundNames)
  )

  return orderSensitive ? undefined : keys
}

const sortDestructureKeys = {
  meta: { fixable: "code" },
  create: (context) => ({
    ObjectPattern: (node) => {
      const keys = sortablePattern(node)
      if (keys === undefined) return

      const indexed = node.properties.map((property, index) => ({ property, key: keys[index] }))
      const sorted = indexed.toSorted(
        (left, right) => left.key.order - right.key.order || naturalKeyCollator.compare(left.key.name, right.key.name)
      )
      const mismatch = indexed.findIndex((entry, index) => entry.property !== sorted[index].property)
      if (mismatch === -1) return

      context.report({
        node: indexed[mismatch].property,
        message: `Expected object destructuring keys to be sorted; ${sorted[mismatch].key.name} belongs before ${indexed[mismatch].key.name}.`,
        fix: (fixer) => {
          const source = context.sourceCode.text
          const separators = node.properties
            .slice(0, -1)
            .map((property, index) => source.slice(property.range[1], node.properties[index + 1].range[0]))
          const text = sorted
            .map(({ property }, index) => context.sourceCode.getText(property) + (separators[index] ?? ""))
            .join("")

          return fixer.replaceTextRange([node.properties[0].range[0], node.properties.at(-1).range[1]], text)
        }
      })
    }
  })
}

const noClockRead = {
  create: (context) => ({
    NewExpression: (node) => {
      if (isIdentifier(node.callee, "Date") && node.arguments.length === 0) {
        report(context, node, "Zero-argument new Date() is banned. Use Effect DateTime.now or inject a clock.")
      }
    },
    CallExpression: (node) => {
      if (
        node.callee.type === "MemberExpression" &&
        isIdentifier(node.callee.object, "Date") &&
        memberName(node.callee) === "now"
      ) {
        report(context, node, "Date.now() is banned. Use Effect Clock.currentTimeMillis or inject a clock.")
      }
    }
  })
}

const noDoubleTypeAssertion = {
  create: (context) => ({
    TSAsExpression: (node) => {
      if (node.expression.type === "TSAsExpression" || node.expression.type === "TSTypeAssertion") {
        report(context, node, "Double type assertions require an explicit Oxlint suppression with justification.")
      }
    },
    TSTypeAssertion: (node) => {
      if (node.expression.type === "TSAsExpression" || node.expression.type === "TSTypeAssertion") {
        report(context, node, "Double type assertions require an explicit Oxlint suppression with justification.")
      }
    }
  })
}

const forbiddenViMembers = new Set([
  "clearAllMocks",
  "doMock",
  "fn",
  "hoisted",
  "mock",
  "mocked",
  "spyOn",
  "stubGlobal",
  "unmock",
  "unstubAllGlobals"
])

const noTestMocks = {
  create: (context) => ({
    CallExpression: (node) => {
      if (node.callee.type !== "MemberExpression") return
      const name = memberName(node.callee)

      if (
        (isIdentifier(node.callee.object, "vi") && forbiddenViMembers.has(name)) ||
        (isIdentifier(node.callee.object, "jest") && name === "mock")
      ) {
        report(context, node, "Test mocks are banned; substitute behavior through Effect layers or explicit ports.")
      }
    }
  })
}

const noTypeAssertion = {
  create: (context) => ({
    TSAsExpression: (node) => {
      const annotation = node.typeAnnotation
      const isConst = annotation.type === "TSTypeReference" && isIdentifier(annotation.typeName, "const")

      if (!isConst) {
        report(context, node, "Type assertions are banned. Parse, use satisfies, or restructure the code.")
      }
    },
    TSTypeAssertion: (node) => {
      report(context, node, "Type assertions are banned. Parse, use satisfies, or restructure the code.")
    }
  })
}

const propertyTestPlacement = {
  create: (context) => {
    if (context.filename.includes(".property.test.") || context.filename.includes(".property.spec.")) return {}

    return {
      ImportDeclaration: (node) => {
        if (node.source.value === "fast-check") {
          report(context, node, "Property-based tests must live in *.property.test.ts files.")
        }
      },
      CallExpression: (node) => {
        if (
          node.callee.type === "MemberExpression" &&
          isIdentifier(node.callee.object, "fc") &&
          memberName(node.callee) === "property"
        ) {
          report(context, node, "Move fc.property tests to a *.property.test.ts file.")
        }
      }
    }
  }
}

const requireCanonicalEffectSchemaImport = {
  create: (context) => ({
    ImportDeclaration: (node) => {
      if (node.source.value !== "effect") return

      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportNamespaceSpecifier") {
          report(context, specifier, "Do not namespace-import Effect; import Schema by its canonical name.")
        }
        if (
          specifier.type === "ImportSpecifier" &&
          isIdentifier(specifier.imported, "Schema") &&
          !isIdentifier(specifier.local, "Schema")
        ) {
          report(context, specifier, "Do not alias Schema imports from Effect.")
        }
      }
    }
  })
}

export default {
  meta: { name: "voila" },
  rules: {
    "no-clock-read": noClockRead,
    "no-double-type-assertion": noDoubleTypeAssertion,
    "no-test-mocks": noTestMocks,
    "no-type-assertion": noTypeAssertion,
    "property-test-placement": propertyTestPlacement,
    "require-canonical-effect-schema-import": requireCanonicalEffectSchemaImport,
    "sort-destructure-keys": sortDestructureKeys
  }
}
