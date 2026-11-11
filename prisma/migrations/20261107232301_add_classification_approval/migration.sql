-- CreateTable
CREATE TABLE "ClassificationApproval" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "cartHash" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "causeId" TEXT NOT NULL,
    "suggestedDonationCents" INTEGER NOT NULL,
    "approvedDonationCents" INTEGER,
    "userAction" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassificationApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClassificationApproval_userId_cartId_idx" ON "ClassificationApproval"("userId", "cartId");
