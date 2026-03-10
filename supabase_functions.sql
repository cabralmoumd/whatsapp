-- ============================================================
-- FUNÇÕES SQL NECESSÁRIAS NO SUPABASE
-- Cole no SQL Editor do Supabase e execute
-- ============================================================

-- 1. Incrementa contadores de envio da instância atomicamente
CREATE OR REPLACE FUNCTION incrementar_contadores_envio(p_instancia_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE instancias_whatsapp
  SET
    msgs_enviadas_hoje = msgs_enviadas_hoje + 1,
    msgs_enviadas_hora_atual = msgs_enviadas_hora_atual + 1
  WHERE id = p_instancia_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Incrementa contador de enviados na campanha
CREATE OR REPLACE FUNCTION incrementar_enviados_campanha(p_campanha_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE campanhas
  SET total_enviados = total_enviados + 1
  WHERE id = p_campanha_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Reseta contadores diários (rodar via cron ou manualmente)
CREATE OR REPLACE FUNCTION resetar_contadores_diarios()
RETURNS void AS $$
BEGIN
  UPDATE instancias_whatsapp
  SET
    msgs_enviadas_hoje = 0,
    ultimo_reset_dia = CURRENT_DATE
  WHERE ultimo_reset_dia < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. View útil para o dashboard — resumo de opt-ins
CREATE OR REPLACE VIEW resumo_optin AS
SELECT
  COUNT(*) FILTER (WHERE optin_marketing IS NULL) AS pendentes,
  COUNT(*) FILTER (WHERE optin_marketing = true)  AS confirmados,
  COUNT(*) FILTER (WHERE optin_marketing = false) AS recusados,
  COUNT(*) AS total,
  ROUND(
    COUNT(*) FILTER (WHERE optin_marketing = true)::numeric /
    NULLIF(COUNT(*) FILTER (WHERE optin_marketing IS NOT NULL), 0) * 100, 1
  ) AS taxa_conversao_pct
FROM clientes
WHERE ativo = true;

-- 5. View de opt-ins por dia (para gráfico do dashboard)
CREATE OR REPLACE VIEW optins_por_dia AS
SELECT
  DATE(data_optin) AS dia,
  COUNT(*) AS total_optins
FROM clientes
WHERE optin_marketing = true
  AND data_optin IS NOT NULL
  AND data_optin >= NOW() - INTERVAL '30 days'
GROUP BY DATE(data_optin)
ORDER BY dia;
