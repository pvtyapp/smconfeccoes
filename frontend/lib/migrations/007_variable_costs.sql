-- 007: variable costs (lanches, linhas, fretes, etc.)
CREATE TABLE IF NOT EXISTS variable_costs (
  id          SERIAL PRIMARY KEY,
  description TEXT        NOT NULL,
  category    TEXT        NOT NULL,
  amount      NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  cost_date   DATE        NOT NULL DEFAULT CURRENT_DATE,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_variable_costs_date ON variable_costs (cost_date);
