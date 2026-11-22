-- Runs once, when the Postgres volume is first initialised.
-- Integration tests use this database so they never touch development data.
CREATE DATABASE inventory_test OWNER inventory;
