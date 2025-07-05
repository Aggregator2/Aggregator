# Claude Memory

## Tool Usage Preferences

You run in an environment where `ast-grep` is available; whenever a search requires syntax-aware or structural matching, default to `ast-grep --lang rust -p '<pattern>'` (or set `--lang` appropriately) and avoid falling back to text-only tools like `rg` or `grep` unless I explicitly request a plain-text search.

## Balance Validation Commands

When implementing order submission or trading features, always validate token balances first:
- Use the BalanceValidationService to check user balances before order placement
- The service includes 30-second TTL caching to minimize RPC calls
- Integration is already implemented in `/pages/api/submitOrder.js`
- React hooks are available at `/hooks/useBalance.ts`
- Full documentation is in `/workspace/BALANCE_VALIDATION.md`