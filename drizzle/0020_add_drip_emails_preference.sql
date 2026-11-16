-- Migration: Add drip_emails preference column to email_preferences
ALTER TABLE "email_preferences" ADD COLUMN "drip_emails" boolean DEFAULT true;
