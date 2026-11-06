-- ══════════════════════════════════════════════════════════════════
-- 022_marketplace_ml_mari.sql  (06/11/2026, PIV)
-- ML_MARI entra no fechamento do marketplace (vende desde 01/11) e o item ganha
-- custo_robo: custo da linha calculado pelo robô do outro PC, usado quando o SKU
-- não cai em nenhuma regra de marketplace_custos (chinelo/trança/body do ML MARI).
-- A API aplica isto sozinha (lib/mktFechamentoDb.ts → garantirEstruturaMkt).
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE marketplace_vendas_itens ADD COLUMN IF NOT EXISTS custo_robo NUMERIC(12,2);
ALTER TABLE marketplace_fechamentos DROP CONSTRAINT IF EXISTS marketplace_fechamentos_loja_check;
ALTER TABLE marketplace_fechamentos ADD CONSTRAINT marketplace_fechamentos_loja_check
  CHECK (loja IN ('SHP_MARI', 'SHP_SAMU', 'TKTK_SAMU', 'ML_MARI'));
