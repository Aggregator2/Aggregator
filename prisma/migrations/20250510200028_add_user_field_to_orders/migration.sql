/*
  Warnings:

  - You are about to drop the column `product` on the `orders` table. All the data in the column will be lost.
  - Added the required column `baseToken` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `quoteToken` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `side` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `user` to the `orders` table without a default value. This is not possible if the table is not empty.

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
    "quantity" INTEGER NOT NULL
);
INSERT INTO "new_orders" ("id", "quantity") SELECT "id", "quantity" FROM "orders";
DROP TABLE "orders";
ALTER TABLE "new_orders" RENAME TO "orders";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
