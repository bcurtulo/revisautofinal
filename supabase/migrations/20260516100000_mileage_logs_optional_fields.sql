-- Alinha schema com uso no server (valor/litros/abastecimento e notas).
ALTER TABLE public.mileage_logs
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS valor REAL,
  ADD COLUMN IF NOT EXISTS litros REAL;
