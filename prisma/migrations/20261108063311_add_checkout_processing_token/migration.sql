/*
  Warnings:

  - A unique constraint covering the columns `[userId,cartId,requestHash]` on the table `CheckoutAttempt` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "CheckoutAttempt_userId_cartId_key";

-- AlterTable
ALTER TABLE "CheckoutAttempt" ADD COLUMN     "processingToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutAttempt_userId_cartId_requestHash_key" ON "CheckoutAttempt"("userId", "cartId", "requestHash");
