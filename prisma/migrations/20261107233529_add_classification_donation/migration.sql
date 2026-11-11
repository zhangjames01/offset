/*
  Warnings:

  - Added the required column `donationCents` to the `ClassificationApproval` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ClassificationApproval" ADD COLUMN     "donationCents" INTEGER NOT NULL;
