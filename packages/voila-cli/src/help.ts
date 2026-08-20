export const helpText = `Usage:
  voila auth login --session <path> [--profile <dir>] [--timeout-ms <ms>] [--json]
  voila auth status [--session <path>] [--json]
  voila auth keepalive [--session <path>] [--interval <s>]
  voila search <query> [--page-size <n>] [--page-token <token>] [--session <path>] [--json]
  voila discounts [query] [--min-percent <n>] [--min-amount <n>] [--sort best-percent|best-amount|price-asc] [--page-size <n>] [--page-token <token>] [--session <path>] [--json]
  voila category products <category-id> [--page-size <n>] [--page-token <token>] [--session <path>] [--json]
  voila orders list [--page-size <n>] [--page-token <token>] [--session <path>] [--json]
  voila orders details <order-id> [--session <path>] [--json]
  voila orders items [--from-date <yyyy-mm-dd>] [--to-date <yyyy-mm-dd>] [--page-size <n>] [--page-token <token>] [--max-orders <n>] [--session <path>] [--json]
  voila cart get [--session <path>] [--json]
  voila cart add <product-id> --quantity <n> [--session <path>] [--json]
  voila cart remove <product-id> --quantity <n> [--session <path>] [--json]`
