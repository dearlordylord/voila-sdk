import effectEslint from "@effect/eslint-plugin"
import { fixupPluginRules } from "@eslint/compat"
import tsParser from "@typescript-eslint/parser"
import functional from "eslint-plugin-functional"
import _import from "eslint-plugin-import"
import importX from "eslint-plugin-import-x"
import simpleImportSort from "eslint-plugin-simple-import-sort"
import sortDestructureKeys from "eslint-plugin-sort-destructure-keys"
import tseslint from "typescript-eslint"

const doubleAssertionSelector = {
  selector: "TSAsExpression > TSAsExpression",
  message: "Double type assertion (as A as B). Requires eslint-disable with justification."
}

const dateBanSelectors = [{
  selector: "NewExpression[callee.name='Date'][arguments.length=0]",
  message: "new Date() is banned. Use Effect Clock/DateTime or inject a now() port."
}, {
  selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
  message: "Date.now() is banned. Use Effect Clock.currentTimeMillis or DateTime.now instead."
}]

const mockBanSelectors = [
  "fn",
  "clearAllMocks",
  "mock",
  "doMock",
  "unmock",
  "hoisted",
  "spyOn",
  "stubGlobal",
  "unstubAllGlobals",
  "mocked"
].map((member) => ({
  selector: `CallExpression[callee.object.name='vi'][callee.property.name='${member}']`,
  message:
    `vi.${member} is banned. Substitute behavior through Effect Layer / ports, not module monkey-patching.`
})).concat([{
  selector: "CallExpression[callee.object.name='jest'][callee.property.name='mock']",
  message: "jest.mock is banned. Use dependency injection."
}])

const effectSchemaAliasBanSelectors = [{
  selector: "ImportDeclaration[source.value='effect'] ImportSpecifier[imported.name='Schema']:not([local.name='Schema'])",
  message: "Do not alias Schema imports from effect. Use the canonical Schema identifier."
}, {
  selector: "ImportDeclaration[source.value='effect'] ImportNamespaceSpecifier",
  message: "Do not namespace-import effect. Import Schema by name for schema linting."
}]

const restrictedSyntaxSelectors = [
  doubleAssertionSelector,
  ...dateBanSelectors,
  ...mockBanSelectors,
  ...effectSchemaAliasBanSelectors,
  {
    selector: "TSAsExpression:not([typeAnnotation.typeName.name='const'])",
    message:
      "Type assertion (as T) is banned. Use Effect Schema decode, satisfies, or restructure code to avoid the cast."
  }
]

const testRestrictedSyntaxSelectors = [
  doubleAssertionSelector,
  ...dateBanSelectors,
  ...mockBanSelectors,
  ...effectSchemaAliasBanSelectors
]

const nonPropertyTestRestrictedSyntaxSelectors = [
  ...testRestrictedSyntaxSelectors,
  {
    selector: "ImportDeclaration[source.value='fast-check']",
    message: "Property-based tests must live in *.property.test.ts files."
  },
  {
    selector: "CallExpression[callee.object.name='fc'][callee.property.name='property']",
    message: "Move fc.property tests to a *.property.test.ts file."
  }
]

export default [
  {
    ignores: ["**/dist", "**/build", "**/*.md", "**/.reference"]
  },

  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["src/**/*.ts", "test/**/*.ts"]
  })),

  ...effectEslint.configs.dprint.map((config) => ({
    ...config,
    files: ["src/**/*.ts", "test/**/*.ts"]
  })),

  {
    files: ["src/**/*.ts", "test/**/*.ts"],

    plugins: {
      functional,
      import: fixupPluginRules(_import),
      "simple-import-sort": simpleImportSort,
      "sort-destructure-keys": sortDestructureKeys
    },

    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        project: "./tsconfig.lint.json",
        tsconfigRootDir: import.meta.dirname
      }
    },

    settings: {
      "import/parsers": {
        "@typescript-eslint/parser": [".ts", ".tsx"]
      },
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true
        }
      }
    },

    rules: {
      "import/first": "error",
      "import/no-duplicates": "error",
      "import/newline-after-import": "off",
      "simple-import-sort/imports": "off",

      "@typescript-eslint/array-type": ["warn", {
        default: "generic",
        readonly: "generic"
      }],
      "@typescript-eslint/consistent-type-assertions": ["error", {
        assertionStyle: "as",
        objectLiteralTypeAssertions: "allow-as-parameter"
      }],
      "@typescript-eslint/consistent-type-imports": "warn",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_"
      }],
      "no-restricted-syntax": ["error", ...restrictedSyntaxSelectors],

      "max-lines": ["error", { max: 420, skipBlankLines: true, skipComments: true }],
      "no-console": "warn",
      "no-magic-numbers": ["warn", {
        enforceConst: true,
        ignore: [0, 1, 2, 100, 200, 300, 400, 401, 403, 404, 500, 1024],
        ignoreArrayIndexes: true,
        ignoreDefaultValues: true
      }],
      "object-shorthand": "error",
      "sort-destructure-keys/sort-destructure-keys": "error",

      ...functional.configs.recommended.rules,
      "functional/functional-parameters": "off",
      "functional/immutable-data": "warn",
      "functional/no-classes": "off",
      "functional/no-class-inheritance": "off",
      "functional/no-conditional-statements": "off",
      "functional/no-expression-statements": "off",
      "functional/no-let": "off",
      "functional/no-loop-statements": "off",
      "functional/no-return-void": "off",
      "functional/no-throw-statements": "off",
      "functional/prefer-immutable-types": "off",
      "functional/prefer-tacit": "error",

      "@effect/dprint": ["error", {
        config: {
          indentWidth: 2,
          lineWidth: 120,
          quoteStyle: "alwaysDouble",
          semiColons: "asi",
          trailingCommas: "never"
        }
      }]
    }
  },

  {
    files: ["src/**/*.ts"],
    plugins: {
      "import-x": importX
    },
    settings: {
      "import-x/parsers": {
        "@typescript-eslint/parser": [".ts", ".tsx"]
      },
      "import-x/resolver": {
        typescript: {
          alwaysTryTypes: true
        }
      }
    },
    rules: {
      "import-x/no-unused-modules": ["error", { unusedExports: true }]
    }
  },

  {
    files: ["src/domain/schemas/**/*.ts"],
    rules: {
      "import-x/no-unused-modules": "off"
    }
  },

  {
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "warn",
      "functional/immutable-data": "off",
      "max-lines": "off",
      "no-magic-numbers": "off",
      "no-restricted-syntax": ["error", ...testRestrictedSyntaxSelectors]
    }
  },

  {
    files: ["test/**/*.test.ts", "test/**/*.spec.ts"],
    ignores: ["test/**/*.property.test.ts", "test/**/*.property.spec.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...nonPropertyTestRestrictedSyntaxSelectors]
    }
  }
]
