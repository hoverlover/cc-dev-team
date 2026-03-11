-- 005: Vault helper functions for secret storage

-- Store a secret in Vault, return the secret ID
CREATE OR REPLACE FUNCTION store_secret(secret_value TEXT, secret_name TEXT)
RETURNS UUID AS $$
  SELECT vault.create_secret(secret_value, secret_name);
$$ LANGUAGE sql SECURITY DEFINER;

-- Retrieve a decrypted secret by its ID
CREATE OR REPLACE FUNCTION get_secret(secret_id UUID)
RETURNS TEXT AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = secret_id;
$$ LANGUAGE sql SECURITY DEFINER;
