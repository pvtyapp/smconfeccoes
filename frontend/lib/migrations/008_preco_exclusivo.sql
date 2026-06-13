-- 008_preco_exclusivo: add preco_exclusivo flag to wa_contacts
ALTER TABLE wa_contacts
  ADD COLUMN IF NOT EXISTS preco_exclusivo BOOLEAN NOT NULL DEFAULT false;
