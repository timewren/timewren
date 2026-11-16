-- Create database if not exists
-- Note: PostgreSQL doesn't support CREATE DATABASE IF NOT EXISTS directly
-- This script runs once when container is first created

-- Create user if not exists
DO $$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'freelance_user') THEN
      CREATE ROLE freelance_user LOGIN PASSWORD 'freelance_password';
   END IF;
END
$$;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE freelance_crm TO freelance_user;
GRANT ALL PRIVILEGES ON DATABASE freelance_crm TO postgres;