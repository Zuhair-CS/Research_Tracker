-- AlterEnum
ALTER TYPE "PublicationSource" ADD VALUE 'OPENALEX';

-- AlterTable
ALTER TABLE "Publication" ADD COLUMN     "openalexId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Publication_ownerId_openalexId_key" ON "Publication"("ownerId", "openalexId");

