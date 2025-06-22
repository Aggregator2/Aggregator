# Wallet Header Dropdowns

## Overview

The WalletHeader component includes two dropdown menus:

### 1. Wallet Dropdown
- **Trigger**: Click on the wallet address button
- **Contents**:
  - Network status with green dot
  - Full wallet address (copyable)
  - Copy Address button
  - Disconnect button
- **Close**: Click outside the dropdown

### 2. Notifications Dropdown (Order History)
- **Trigger**: Click on the bell icon
- **Contents**:
  - "Order History" header
  - List of recent orders with:
    - Status icon (✅ filled, ⏳ pending, ❌ failed)
    - Token swap details (e.g., "1.5 ETH → 3000 USDC")
    - Timestamp
    - Transaction link (if available)
- **Badge**: Shows count of orders from last 5 minutes
- **Close**: Click outside the dropdown

## Implementation Details

Both dropdowns use:
- `useState` for visibility control
- `useRef` for click-outside detection
- `z-index: 1000` for proper layering
- Smooth slide-in animation
- Dark theme with backdrop blur

## Testing

1. Start the dev server: `npm run dev`
2. Connect your wallet
3. Click on the wallet address - dropdown should appear
4. Click on the bell icon - order history should appear
5. Both should close when clicking outside

## Troubleshooting

If dropdowns aren't working:

1. **Check Browser Console**: Look for the debug logs:
   - "Wallet button clicked, current state: false/true"
   - "Notification button clicked, current state: false/true"

2. **Check CSS Loading**: Ensure styles are applied:
   - Dropdowns should have `position: absolute`
   - Parent containers should have `position: relative`
   - z-index should be 1000

3. **Test Data**: The app now includes test orders by default to show in the notifications

4. **Common Issues**:
   - If clicks aren't registering, check for overlapping elements
   - If dropdowns appear but are invisible, check background colors
   - If positioning is off, check parent container styles

The dropdowns are fully implemented and should work out of the box!