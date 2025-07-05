-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "walletAddress" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "stock" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalAmount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "txHash" TEXT,
    "escrowAddress" TEXT,
    "signature" TEXT,
    "paymentMethod" TEXT,
    "shippingAddress" JSONB,
    "billingAddress" JSONB,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" REAL NOT NULL,
    "totalPrice" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LineItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "comment" TEXT,
    "changedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketMaker" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "apiKey" TEXT NOT NULL,
    "apiSecret" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "websocketUrl" TEXT,
    "supportedPairs" TEXT NOT NULL DEFAULT '[]',
    "minQuoteSize" REAL NOT NULL DEFAULT 0,
    "maxQuoteSize" REAL NOT NULL DEFAULT 1000000,
    "quoteExpiry" INTEGER NOT NULL DEFAULT 30000,
    "settlementAddress" TEXT,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketMakerPair" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketMakerId" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "minSize" REAL NOT NULL DEFAULT 0.001,
    "maxSize" REAL NOT NULL DEFAULT 10000,
    "tickSize" REAL NOT NULL DEFAULT 0.00001,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "spreadBps" INTEGER NOT NULL DEFAULT 10,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketMakerPair_marketMakerId_fkey" FOREIGN KEY ("marketMakerId") REFERENCES "MarketMaker" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RFQ" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "baseAmount" REAL,
    "quoteAmount" REAL,
    "orderFlowType" TEXT NOT NULL DEFAULT 'PUBLIC',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" DATETIME NOT NULL,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RFQ_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "marketMakerId" TEXT NOT NULL,
    "bidPrice" REAL,
    "askPrice" REAL,
    "bidSize" REAL,
    "askSize" REAL,
    "price" REAL NOT NULL,
    "size" REAL NOT NULL,
    "side" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" DATETIME NOT NULL,
    "filledSize" REAL NOT NULL DEFAULT 0,
    "signature" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Quote_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Quote_marketMakerId_fkey" FOREIGN KEY ("marketMakerId") REFERENCES "MarketMaker" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Auction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "minParticipants" INTEGER NOT NULL DEFAULT 2,
    "winningQuoteId" TEXT,
    "executedPrice" REAL,
    "executedSize" REAL,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Auction_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketMakerInventory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketMakerId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "balance" REAL NOT NULL DEFAULT 0,
    "available" REAL NOT NULL DEFAULT 0,
    "locked" REAL NOT NULL DEFAULT 0,
    "lastUpdated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketMakerInventory_marketMakerId_fkey" FOREIGN KEY ("marketMakerId") REFERENCES "MarketMaker" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inventoryId" TEXT NOT NULL,
    "marketMakerId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "balanceBefore" REAL NOT NULL,
    "balanceAfter" REAL NOT NULL,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryEvent_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "MarketMakerInventory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryEvent_marketMakerId_fkey" FOREIGN KEY ("marketMakerId") REFERENCES "MarketMaker" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketMakerTrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketMakerId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "baseAmount" REAL NOT NULL,
    "quoteAmount" REAL NOT NULL,
    "price" REAL NOT NULL,
    "fee" REAL NOT NULL DEFAULT 0,
    "rebate" REAL NOT NULL DEFAULT 0,
    "pnl" REAL,
    "txHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "executedAt" DATETIME,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketMakerTrade_marketMakerId_fkey" FOREIGN KEY ("marketMakerId") REFERENCES "MarketMaker" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MarketMakerTrade_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MarketMakerTrade_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "RFQ" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MarketMakerTrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeeStructure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketMakerId" TEXT,
    "tierName" TEXT NOT NULL,
    "feeType" TEXT NOT NULL,
    "baseCurrency" TEXT,
    "quoteCurrency" TEXT,
    "minVolume" REAL NOT NULL DEFAULT 0,
    "maxVolume" REAL,
    "feeBps" INTEGER NOT NULL,
    "flatFee" REAL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FeeStructure_marketMakerId_fkey" FOREIGN KEY ("marketMakerId") REFERENCES "MarketMaker" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketMakerPerformance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketMakerId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "totalVolume" REAL NOT NULL DEFAULT 0,
    "totalTrades" INTEGER NOT NULL DEFAULT 0,
    "totalPnL" REAL NOT NULL DEFAULT 0,
    "totalFees" REAL NOT NULL DEFAULT 0,
    "totalRebates" REAL NOT NULL DEFAULT 0,
    "fillRate" REAL NOT NULL DEFAULT 0,
    "avgSpread" REAL NOT NULL DEFAULT 0,
    "uptime" REAL NOT NULL DEFAULT 100,
    "metrics" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketMakerPerformance_marketMakerId_fkey" FOREIGN KEY ("marketMakerId") REFERENCES "MarketMaker" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_walletAddress_idx" ON "User"("walletAddress");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_orderNumber_idx" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "LineItem_orderId_idx" ON "LineItem"("orderId");

-- CreateIndex
CREATE INDEX "LineItem_productId_idx" ON "LineItem"("productId");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_orderId_idx" ON "OrderStatusHistory"("orderId");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_createdAt_idx" ON "OrderStatusHistory"("createdAt");

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
