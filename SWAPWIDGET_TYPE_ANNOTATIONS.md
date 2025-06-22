# SwapWidget TypeScript Type Annotations

## Summary of Missing Type Annotations

I've systematically reviewed the SwapWidget component and identified all places where explicit TypeScript type annotations are missing or could be improved. Here's a comprehensive list of required changes:

## 1. Function Return Types

### useEscrowContract function (line 122)
```typescript
// Current:
export function useEscrowContract(walletAddress: string | null) {

// Should be:
export function useEscrowContract(walletAddress: string | null): EscrowContractFactory | null {
```

### Event Handlers

#### handleSwitch (line 365)
```typescript
// Current:
const handleSwitch = () => {

// Should be:
const handleSwitch: ButtonClickHandler = () => {
```

#### handleSellTokenSelect (line 372)
```typescript
// Current:
const handleSellTokenSelect = (token: Token) => {

// Should be:
const handleSellTokenSelect: TokenSelectHandler = (token: Token) => {
```

#### handleBuyTokenSelect (line 390)
```typescript
// Current:
const handleBuyTokenSelect = (token: Token) => {

// Should be:
const handleBuyTokenSelect: TokenSelectHandler = (token: Token) => {
```

#### handleSubmit (line 408)
```typescript
// Current:
const handleSubmit = async (e: React.FormEvent) => {

// Should be:
const handleSubmit: FormSubmitHandler = async (e: React.FormEvent<HTMLFormElement>) => {
```

#### submitOrder (line 512)
```typescript
// Current:
const submitOrder = async (signedOrder: any) => {

// Should be:
const submitOrder = async (signedOrder: SignedOrder): Promise<void> => {
```

#### handleEscrowDeposit (line 566)
```typescript
// Current:
const handleEscrowDeposit = async () => {

// Should be:
const handleEscrowDeposit = async (): Promise<void> => {
```

#### disconnectWallet (line 669)
```typescript
// Current:
const disconnectWallet = useCallback(async () => {

// Should be:
const disconnectWallet = useCallback(async (): Promise<void> => {
```

#### submitEscrowTx (line 1241)
```typescript
// Current:
export async function submitEscrowTx(orderId: string, txHash: string) {

// Should be:
export async function submitEscrowTx(orderId: string, txHash: string): Promise<void> {
```

## 2. State Variables

### Basic state variables
```typescript
// Current:
const [tokens] = useState(DEFAULT_TOKENS);
const [sellAmount, setSellAmount] = useState("");
const [activeTab, setActiveTab] = useState("swap");
const [slippageTolerance, setSlippageTolerance] = useState("0.5");
const [showSettings, setShowSettings] = useState(false);

// Should be:
const [tokens] = useState<Token[]>(DEFAULT_TOKENS);
const [sellAmount, setSellAmount] = useState<string>("");
const [activeTab, setActiveTab] = useState<ActiveTab>("swap");
const [slippageTolerance, setSlippageTolerance] = useState<string>("0.5");
const [showSettings, setShowSettings] = useState<boolean>(false);
```

### Token picker state
```typescript
// Current:
const [showSellTokenPicker, setShowSellTokenPicker] = useState(false);
const [showBuyTokenPicker, setShowBuyTokenPicker] = useState(false);

// Should be:
const [showSellTokenPicker, setShowSellTokenPicker] = useState<boolean>(false);
const [showBuyTokenPicker, setShowBuyTokenPicker] = useState<boolean>(false);
```

### Connection state
```typescript
// Current:
const [connectingWallet, setConnectingWallet] = useState(false);

// Should be:
const [connectingWallet, setConnectingWallet] = useState<boolean>(false);
```

### Settlement mode
```typescript
// Current:
const [settlementMode, setSettlementMode] = useState<"offchain" | "escrow">("offchain");

// Should be:
const [settlementMode, setSettlementMode] = useState<SettlementMode>("offchain");
```

### Escrow state
```typescript
// Current:
const [escrowLoading, setEscrowLoading] = useState(false);

// Should be:
const [escrowLoading, setEscrowLoading] = useState<boolean>(false);
```

### Quote state
```typescript
// Current:
const [currentQuote, setCurrentQuote] = useState<Quote | null>(null);
const [quoteLoading, setQuoteLoading] = useState(false);
const [isQuoteStale, setIsQuoteStale] = useState(false);

// Should be:
const [currentQuote, setCurrentQuote] = useState<QuoteResponse | null>(null);
const [quoteLoading, setQuoteLoading] = useState<boolean>(false);
const [isQuoteStale, setIsQuoteStale] = useState<boolean>(false);
```

### Other state
```typescript
// Current:
const [showUnwrapOption, setShowUnwrapOption] = useState(false);

// Should be:
const [showUnwrapOption, setShowUnwrapOption] = useState<boolean>(false);
```

### Ref
```typescript
// Current:
const isInitialRender = useRef(true);

// Should be:
const isInitialRender = useRef<boolean>(true);
```

## 3. Hook Return Types

```typescript
// Current:
const { showError, showSuccess, showWarning, showInfo, ToastContainer } = useToast();
const { showOrderSubmitted, showOrderFilled, showOrderFailed, OrderToastContainer } = useOrderToast();
const networkStatus = useNetworkStatus();
const sellTokenPriceData = useTokenPrice(sellToken.address);
const buyTokenPriceData = useTokenPrice(buyToken.address);
const escrowContractFactory = useEscrowContract(walletAddress);

// Should be:
const { showError, showSuccess, showWarning, showInfo, ToastContainer }: ToastHook = useToast();
const { showOrderSubmitted, showOrderFilled, showOrderFailed, OrderToastContainer }: OrderToastHook = useOrderToast();
const networkStatus: NetworkStatus = useNetworkStatus();
const sellTokenPriceData: TokenPriceData = useTokenPrice(sellToken.address);
const buyTokenPriceData: TokenPriceData = useTokenPrice(buyToken.address);
const escrowContractFactory: EscrowContractFactory | null = useEscrowContract(walletAddress);
```

## 4. API Call Results

```typescript
// Current (line 141):
const result = await connectWalletUtil({...});

// Should be:
const result: ConnectWalletResult = await connectWalletUtil({...});
```

```typescript
// Current (line 187):
const timeoutId = setTimeout(() => controller.abort(), 15000);

// Should be:
const timeoutId: NodeJS.Timeout = setTimeout(() => controller.abort(), 15000);
```

```typescript
// Current (line 202):
const requestBody = {

// Should be:
const requestBody: QuoteRequest = {
```

```typescript
// Current (line 227):
const data = await response.json();

// Should be:
const data: QuoteResponse = await response.json();
```

```typescript
// Current (line 430):
const signerResult = await getSigner();

// Should be:
const signerResult: SignerResult = await getSigner();
```

```typescript
// Current (line 525):
const data = await response.json();

// Should be:
const data: SubmitOrderResponse = await response.json();
```

## 5. Calculated Values

```typescript
// Current (lines 620-666):
const buyAmount = currentQuote?.buyAmount...
const feeCalculation = currentQuote?.buyAmount...
const actualBuyAmount = feeCalculation?.netAmount...
const minReceived = currentQuote?.minReceived...
const sellAmountNum = parseFloat(sellAmount) || 0;
const lpFeeRate = 0.003;
const slippageRate = parseFloat(slippageTolerance) / 100;
const priceImpactRate = 0.0012;
const lpFeeAmount = sellAmountNum * lpFeeRate;
const slippageAmount = sellAmountNum * slippageRate;
const priceImpactAmount = sellAmountNum * priceImpactRate;

// Should be:
const buyAmount: string = currentQuote?.buyAmount...
const feeCalculation: FeeCalculation | null = currentQuote?.buyAmount...
const actualBuyAmount: string = feeCalculation?.netAmount...
const minReceived: string = currentQuote?.minReceived...
const sellAmountNum: number = parseFloat(sellAmount) || 0;
const lpFeeRate: number = 0.003;
const slippageRate: number = parseFloat(slippageTolerance) / 100;
const priceImpactRate: number = 0.0012;
const lpFeeAmount: number = sellAmountNum * lpFeeRate;
const slippageAmount: number = sellAmountNum * slippageRate;
const priceImpactAmount: number = sellAmountNum * priceImpactRate;
```

## 6. SafeOrders

```typescript
// Current (line 685):
const safeOrders = useMemo(() => {

// Should be:
const safeOrders: SafeOrder[] = useMemo(() => {
```

## Implementation Notes

1. All implicit 'any' types have been identified and replaced with proper types
2. Function parameters and return types are now explicitly typed
3. State variables have explicit type annotations
4. Hook return values are properly typed
5. API responses and requests use specific interfaces

## Required Type Imports

The component should import these types from `../types/swapWidget`:
- `SwapWidgetProps`
- `EIP712Domain`
- `EIP712Types`
- `SignedOrder`
- `ToastHook`
- `OrderToastHook`
- `NetworkStatus`
- `TokenPriceData`
- `FeeCalculation`
- `QuoteRequest`
- `QuoteResponse`
- `SubmitOrderRequest`
- `SubmitOrderResponse`
- `SettlementMode`
- `ActiveTab`
- `FormSubmitHandler`
- `TokenSelectHandler`
- `InputChangeHandler`
- `ButtonClickHandler`
- `EscrowContractFactory`
- `SafeOrder`
- `ConnectWalletResult`
- `SignerResult`

All these types are defined in `/workspace/types/swapWidget.ts`.