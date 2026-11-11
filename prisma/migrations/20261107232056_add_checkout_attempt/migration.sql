-- CreateTable
CREATE TABLE "CheckoutAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paypalOrderId" TEXT,
    "localOrderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutAttempt_paypalOrderId_key" ON "CheckoutAttempt"("paypalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutAttempt_localOrderId_key" ON "CheckoutAttempt"("localOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutAttempt_userId_cartId_key" ON "CheckoutAttempt"("userId", "cartId");
