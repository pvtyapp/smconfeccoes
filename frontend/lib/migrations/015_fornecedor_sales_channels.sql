-- ══════════════════════════════════════════════════════════════════
-- 015_fornecedor_sales_channels.sql
-- Formulário "Quero comprar com vocês" trocou nome do negócio/observação
-- livre por canais de venda marcáveis (Shopee, TikTok, Outros).
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE fornecedor_solicitacoes
  ADD COLUMN IF NOT EXISTS sales_channels TEXT[];
