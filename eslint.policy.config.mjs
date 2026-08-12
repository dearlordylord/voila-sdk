import tsParser from "@typescript-eslint/parser"
import functional from "eslint-plugin-functional"
import importX from "eslint-plugin-import-x"

const sourceAndTestFiles = ["packages/*/src/**/*.ts", "packages/*/test/**/*.ts"]

export default [
  { ignores: ["**/dist", "**/build", "**/coverage"] },
  {
    files: sourceAndTestFiles,
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: "./tsconfig.lint.json", tsconfigRootDir: import.meta.dirname }
    },
    plugins: { functional },
    rules: {
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
      "functional/prefer-tacit": "error"
    }
  },
  {
    files: ["packages/*/src/**/*.ts"],
    plugins: { "import-x": importX },
    settings: {
      "import-x/parsers": { "@typescript-eslint/parser": [".ts", ".tsx"] },
      "import-x/resolver": { typescript: { alwaysTryTypes: true } }
    },
    rules: { "import-x/no-unused-modules": ["error", { unusedExports: true }] }
  },
  { files: ["packages/*/src/domain/schemas/**/*.ts"], rules: { "import-x/no-unused-modules": "off" } },
  { files: ["**/*.test.ts", "**/*.spec.ts"], rules: { "functional/immutable-data": "off" } }
]
