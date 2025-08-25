# SwappiQ Fees and Transparency

## Overview

SwappiQ is committed to complete transparency in our fee structure. Unlike many DEX aggregators that hide fees in worse exchange rates, we clearly display all fees upfront so users can make informed decisions.

## Fee Structure

### Platform Fee
- **Amount**: 0.3% (30 basis points)
- **Applied to**: All trades
- **Visibility**: Transparently shown in every quote

### How It Works

When you request a quote, you'll see:
1. **Market Price**: The best available price from our liquidity sources
2. **Platform Fee**: Clearly labeled 0.3% fee
3. **Your Price**: The final price after the platform fee

### Example

For a 1 ETH → USDC swap at $3,500 market price:
- Market quote: 3,500 USDC
- Platform fee (0.3%): 10.5 USDC
- You receive: 3,489.5 USDC

## API Response Format

All quotes include transparent fee information:

```json
{
  "buyAmount": "3489500000",              // Amount you receive (after fee)
  "buyAmountBeforeFee": "3500000000",     // Market amount (before fee)
  "platformFee": {
    "amount": "10500000",                 // Fee amount in tokens
    "percentage": 0.3,                    // Fee percentage
    "bps": 30                             // Fee in basis points
  },
  "feeBreakdown": {
    "platformFee": "10500000",
    "platformFeePercent": "0.3%",
    "buyAmountBeforeFee": "3500000000",
    "buyAmountAfterFee": "3489500000"
  }
}
```

## UI Display

In the SwappiQ interface, you'll see:

```
Platform Fee (0.3%)    10.5 USDC
LP Fee (0.3%)         0.003 ETH
Max Slippage (0.5%)   17.5 USDC
Minimum Received      3,472 USDC
```

## Why We Charge Fees

The 0.3% platform fee helps us:
- Maintain and improve the platform
- Integrate new liquidity sources
- Provide 24/7 support
- Ensure security through audits
- Develop new features

## Comparison with Competitors

| Platform | Fee Model | Transparency |
|----------|-----------|--------------|
| SwappiQ | 0.3% platform fee | ✅ Fully transparent |
| Competitor A | Hidden in spread | ❌ Not disclosed |
| Competitor B | 0-0.85% variable | ⚠️ Partially disclosed |
| Competitor C | 0.15% + hidden markup | ❌ Not transparent |

## No Hidden Fees

We guarantee:
- ✅ No hidden markups
- ✅ No surprise charges
- ✅ No worse rates than displayed
- ✅ All fees shown upfront

## Fee Exemptions

Currently, there are no fee exemptions. All users pay the same transparent 0.3% fee.

## Future Fee Changes

Any changes to our fee structure will be:
1. Announced 30 days in advance
2. Clearly communicated to all users
3. Updated in this documentation

## Questions?

If you have questions about our fees:
- Email: support@swappiq.com
- Discord: [Join our community](https://discord.gg/swappiq)
- API Docs: [Developer Portal](https://swappiq.com/developers/api)

---

Last updated: January 2025