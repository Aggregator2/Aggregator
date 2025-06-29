-- CreateEnum
CREATE TYPE "MarketMakerStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "RFQStatus" AS ENUM ('PENDING', 'QUOTED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'EXECUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('ACTIVE', 'FILLED', 'PARTIALLY_FILLED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderFlowType" AS ENUM ('PUBLIC', 'PRIVATE', 'AUCTION');

-- CreateEnum
CREATE TYPE "FeeType" AS ENUM ('MAKER_REBATE', 'TAKER_FEE', 'PLATFORM_FEE');

-- CreateEnum
CREATE TYPE "InventoryEventType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRADE_BUY', 'TRADE_SELL', 'FEE', 'REBATE', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "MarketMaker" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "MarketMakerStatus" NOT NULL DEFAULT 'PENDING',
    "apiKey" TEXT NOT NULL,
    "apiSecret" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "websocketUrl" TEXT,
    "supportedPairs" TEXT[],
    "minQuoteSize" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "maxQuoteSize" DECIMAL(20,8) NOT NULL DEFAULT 1000000,
    "quoteExpiry" INTEGER NOT NULL DEFAULT 30000,
    "settlementAddress" TEXT,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketMaker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketMakerPair" (
    "id" TEXT NOT NULL,
    "marketMakerId" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "minSize" DECIMAL(20,8) NOT NULL DEFAULT 0.001,
    "maxSize" DECIMAL(20,8) NOT NULL DEFAULT 10000,
    "tickSize" DECIMAL(20,8) NOT NULL DEFAULT 0.00001,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "spreadBps" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketMakerPair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RFQ" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "baseAmount" DECIMAL(20,8),
    "quoteAmount" DECIMAL(20,8),
    "orderFlowType" "OrderFlowType" NOT NULL DEFAULT 'PUBLIC',
    "status" "RFQStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RFQ_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "marketMakerId" TEXT NOT NULL,
    "bidPrice" DECIMAL(20,8),
    "askPrice" DECIMAL(20,8),
    "bidSize" DECIMAL(20,8),
    "askSize" DECIMAL(20,8),
    "price" DECIMAL(20,8) NOT NULL,
    "size" DECIMAL(20,8) NOT NULL,
    "side" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "filledSize" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "signature" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auction" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "minParticipants" INTEGER NOT NULL DEFAULT 2,
    "winningQuoteId" TEXT,
    "executedPrice" DECIMAL(20,8),
    "executedSize" DECIMAL(20,8),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketMakerInventory" (
    "id" TEXT NOT NULL,
    "marketMakerId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "balance" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "available" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "locked" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketMakerInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryEvent" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "marketMakerId" TEXT NOT NULL,
    "eventType" "InventoryEventType" NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "balanceBefore" DECIMAL(20,8) NOT NULL,
    "balanceAfter" DECIMAL(20,8) NOT NULL,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketMakerTrade" (
    "id" TEXT NOT NULL,
    "marketMakerId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "baseAmount" DECIMAL(20,8) NOT NULL,
    "quoteAmount" DECIMAL(20,8) NOT NULL,
    "price" DECIMAL(20,8) NOT NULL,
    "fee" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "rebate" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "pnl" DECIMAL(20,8),
    "txHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "executedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketMakerTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeStructure" (
    "id" TEXT NOT NULL,
    "marketMakerId" TEXT,
    "tierName" TEXT NOT NULL,
    "feeType" "FeeType" NOT NULL,
    "baseCurrency" TEXT,
    "quoteCurrency" TEXT,
    "minVolume" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "maxVolume" DECIMAL(20,8),
    "feeBps" INTEGER NOT NULL,
    "flatFee" DECIMAL(20,8),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketMakerPerformance" (
    "id" TEXT NOT NULL,
    "marketMakerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalVolume" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "totalTrades" INTEGER NOT NULL DEFAULT 0,
    "totalPnL" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "totalFees" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "totalRebates" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "fillRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "avgSpread" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "uptime" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "metrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketMakerPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketMaker_code_key" ON "MarketMaker"("code");

-- CreateIndex
CREATE UNIQUE INDEX "MarketMaker_apiKey_key" ON "MarketMaker"("apiKey");

-- CreateIndex
CREATE INDEX "MarketMaker_status_idx" ON "MarketMaker"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketMakerPair_marketMakerId_baseCurrency_quoteCurrency_key" ON "MarketMakerPair"("marketMakerId", "baseCurrency", "quoteCurrency");

-- CreateIndex
CREATE UNIQUE INDEX "RFQ_requestId_key" ON "RFQ"("requestId");

-- CreateIndex
CREATE INDEX "RFQ_userId_idx" ON "RFQ"("userId");

-- CreateIndex
CREATE INDEX "RFQ_status_idx" ON "RFQ"("status");

-- CreateIndex
CREATE INDEX "RFQ_expiresAt_idx" ON "RFQ"("expiresAt");

-- CreateIndex
CREATE INDEX "Quote_rfqId_idx" ON "Quote"("rfqId");

-- CreateIndex
CREATE INDEX "Quote_marketMakerId_idx" ON "Quote"("marketMakerId");

-- CreateIndex
CREATE INDEX "Quote_status_idx" ON "Quote"("status");

-- CreateIndex
CREATE INDEX "Quote_expiresAt_idx" ON "Quote"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Auction_rfqId_key" ON "Auction"("rfqId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketMakerInventory_marketMakerId_currency_key" ON "MarketMakerInventory"("marketMakerId", "currency");

-- CreateIndex
CREATE INDEX "InventoryEvent_inventoryId_idx" ON "InventoryEvent"("inventoryId");

-- CreateIndex
CREATE INDEX "InventoryEvent_marketMakerId_idx" ON "InventoryEvent"("marketMakerId");

-- CreateIndex
CREATE INDEX "InventoryEvent_createdAt_idx" ON "InventoryEvent"("createdAt");

-- CreateIndex
CREATE INDEX "MarketMakerTrade_marketMakerId_idx" ON "MarketMakerTrade"("marketMakerId");

-- CreateIndex
CREATE INDEX "MarketMakerTrade_userId_idx" ON "MarketMakerTrade"("userId");

-- CreateIndex
CREATE INDEX "MarketMakerTrade_createdAt_idx" ON "MarketMakerTrade"("createdAt");

-- CreateIndex
CREATE INDEX "FeeStructure_marketMakerId_idx" ON "FeeStructure"("marketMakerId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketMakerPerformance_marketMakerId_date_key" ON "MarketMakerPerformance"("marketMakerId", "date");

-- AddForeignKey
ALTER TABLE "MarketMakerPair" ADD CONSTRAINT "MarketMakerPair_marketMakerId_fkey" FOREIGN KEY ("marketMakerId") REFERENCES "MarketMaker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RFQ" ADD CONSTRAINT "RFQ_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_marketMakerId_fkey" FOREIGN KEY ("marketMakerId") REFERENCES "MarketMaker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketMakerInventory" ADD CONSTRAINT "MarketMakerInventory_marketMakerId_fkey" FOREIGN KEY ("marketMakerId") REFERENCES "MarketMaker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "MarketMakerInventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_marketMakerId_fkey" FOREIGN KEY ("marketMakerId") REFERENCES "MarketMaker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketMakerTrade" ADD CONSTRAINT "MarketMakerTrade_marketMakerId_fkey" FOREIGN KEY ("marketMakerId") REFERENCES "MarketMaker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketMakerTrade" ADD CONSTRAINT "MarketMakerTrade_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketMakerTrade" ADD CONSTRAINT "MarketMakerTrade_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketMakerTrade" ADD CONSTRAINT "MarketMakerTrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeStructure" ADD CONSTRAINT "FeeStructure_marketMakerId_fkey" FOREIGN KEY ("marketMakerId") REFERENCES "MarketMaker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketMakerPerformance" ADD CONSTRAINT "MarketMakerPerformance_marketMakerId_fkey" FOREIGN KEY ("marketMakerId") REFERENCES "MarketMaker"("id") ON DELETE CASCADE ON UPDATE CASCADE;