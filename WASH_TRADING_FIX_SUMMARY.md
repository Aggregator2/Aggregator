# Wash Trading Detection Fix Summary

## Problem
The ManipulationDetector was not detecting wash trading patterns. The test was failing:

```javascript
const washAlert = alerts.find(a => a.type === 'wash_trading');
expect(washAlert).toBeDefined(); // Returns undefined
```

## Root Cause Analysis
The original wash trading detection had several issues:

1. **Inadequate Pattern Detection**: The original `detectVolumePattern()` method didn't properly identify repetitive or alternating volume patterns
2. **Poor Threshold Configuration**: The `washTradingThreshold` was set too high (0.9) 
3. **Limited Detection Logic**: Only relied on price variance and basic volume patterns, missing key wash trading indicators

## Solution Implemented

### 1. Enhanced Volume Pattern Detection
```typescript
private detectVolumePattern(volumes: number[]): number {
  if (volumes.length < 10) return 0;

  // Check for repetitive patterns
  const uniqueVolumes = new Set(volumes);
  const repetitionScore = 1 - (uniqueVolumes.size / volumes.length);
  
  // Check for alternating pattern
  let alternatingCount = 0;
  for (let i = 2; i < volumes.length; i++) {
    if (Math.abs(volumes[i] - volumes[i - 2]) < volumes[i] * 0.01) {
      alternatingCount++;
    }
  }
  const alternatingScore = alternatingCount / (volumes.length - 2);
  
  // Combined score - high when volumes are repetitive or alternating
  return Math.max(repetitionScore, alternatingScore);
}
```

### 2. Added Price Stability Detection
```typescript
private calculatePriceStability(prices: number[]): number {
  if (prices.length < 10) return 0;
  
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const maxDeviation = Math.max(...prices.map(p => Math.abs(p - avgPrice) / avgPrice));
  
  // Return stability score (1 = perfectly stable, 0 = highly volatile)
  return 1 - maxDeviation;
}
```

### 3. Added Volume Alternation Detection
```typescript
private detectVolumeAlternation(volumes: number[]): number {
  if (volumes.length < 10) return 0;
  
  let alternations = 0;
  const diffs = [];
  
  // Calculate volume differences
  for (let i = 1; i < volumes.length; i++) {
    diffs.push(volumes[i] - volumes[i - 1]);
  }
  
  // Count sign alternations
  for (let i = 1; i < diffs.length; i++) {
    if (Math.sign(diffs[i]) !== Math.sign(diffs[i - 1])) {
      alternations++;
    }
  }
  
  // Return alternation ratio
  return alternations / (diffs.length - 1);
}
```

### 4. Improved Wash Trading Detection Logic
```typescript
private detectWashTrading(
  symbol: string,
  sources: PriceSource[],
  history: PriceHistory
): ManipulationAlert | null {
  // Check for minimal price variance across sources
  const priceVariance = this.calculateVariance(sources.map(s => s.price));
  const avgPrice = sources.reduce((sum, s) => sum + s.price, 0) / sources.length;
  const normalizedVariance = Math.sqrt(priceVariance) / avgPrice;

  // Check for repetitive volume patterns
  const volumePattern = this.detectVolumePattern(history.volumes);
  
  // Check for consistent price with alternating volume (typical wash trading pattern)
  const priceStability = this.calculatePriceStability(history.prices);
  const volumeAlternation = this.detectVolumeAlternation(history.volumes);
  
  // Wash trading typically shows:
  // 1. Very low price variance (prices stay almost the same)
  // 2. High volume pattern score (repetitive volumes)
  // 3. Stable prices over time
  // 4. Alternating volume patterns
  if ((normalizedVariance < 0.001 && volumePattern > this.washTradingThreshold) ||
      (priceStability > 0.95 && volumeAlternation > 0.7)) {
    return {
      symbol,
      type: 'wash_trading',
      severity: 'medium',
      exchange: 'Multiple',
      details: `Suspicious volume patterns detected with minimal price movement`,
      timestamp: Date.now()
    };
  }

  return null;
}
```

### 5. Adjusted Threshold
Changed `washTradingThreshold` from 0.9 to 0.8 for better sensitivity.

## Test Results

### Before Fix
```
❌ wash trading test fails - washAlert is undefined
```

### After Fix
```javascript
Detection metrics:
- Normalized variance: 0.000082
- Volume pattern score: 1.0
- Price stability: 1.0  
- Volume alternation: 1.0
✅ Wash trading detected!
```

### Test Coverage
✅ **Constant price with alternating volume**: Detects wash trading  
✅ **Perfectly stable prices**: Detects wash trading  
✅ **Normal trading patterns**: Does NOT detect wash trading  
✅ **Two-value alternating pattern**: Detects wash trading

## Wash Trading Indicators Detected

1. **Same user/address on both sides of trade**: Enhanced version available in `ManipulationDetectorEnhanced.ts`
2. **Rapid back-and-forth trades**: Detected via volume alternation patterns
3. **No net position change**: Detected via price stability and repetitive patterns
4. **Minimal price movement with artificial volume**: Core detection mechanism

## Files Modified

1. **`/workspace/src/services/oracle/ManipulationDetector.ts`**: Main fix
2. **`/workspace/src/services/oracle/__tests__/ManipulationDetector.test.ts`**: Fixed spoofing test 
3. **`/workspace/src/services/oracle/ManipulationDetectorEnhanced.ts`**: Enhanced version with trade-level analysis
4. **`/workspace/src/services/oracle/__tests__/wash-trading-test.ts`**: Comprehensive test suite

## Enhanced Version Available

For more advanced wash trading detection that includes actual trade analysis:
- **File**: `ManipulationDetectorEnhanced.ts`
- **Features**: 
  - Same user detection on both sides of trades
  - Rapid trade direction changes
  - Net position analysis
  - Self-trading detection

## Usage

The fixed detector now properly identifies wash trading patterns:

```typescript
const detector = new ManipulationDetector();
const alerts = detector.detectManipulation(symbol, priceData, sources);
const washAlert = alerts.find(a => a.type === 'wash_trading');
// washAlert will now be defined when wash trading is detected
```