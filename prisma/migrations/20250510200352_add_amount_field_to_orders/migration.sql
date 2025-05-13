/*
  Warnings:

  - Added the required column `amount` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `price` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `validTo` to the `orders` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_orders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user" TEXT NOT NULL,
    "baseToken" TEXT NOT NULL,
    "quoteToken" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "price" REAL NOT NULL,
    "validTo" INTEGER NOT NULL
);
INSERT INTO "new_orders" ("baseToken", "id", "quantity", "quoteToken", "side", "user") SELECT "baseToken", "id", "quantity", "quoteToken", "side", "user" FROM "orders";
DROP TABLE "orders";
ALTER TABLE "new_orders" RENAME TO "orders";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
