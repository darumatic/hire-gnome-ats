-- AlterTable
ALTER TABLE `JobOrder` ADD COLUMN `applicationQuestions` JSON NOT NULL DEFAULT (JSON_ARRAY());
