-- =====================================================================
-- Acende o eixo financeiro nos vales que já divergiram
--
-- `status_financeiro` existe desde o schema inicial com três valores
-- ('na_ordem', 'divergente', 'conferido') e o CLAUDE.md defende os três
-- eixos como independentes. Mas nada no app nunca escreveu nessa coluna:
-- todo vale ficava em 'na_ordem' pra sempre, inclusive os que tinham
-- divergência de pagamento registrada em `pagamentos` e evento
-- `pagamento_alterado` no log.
--
-- O código passou a gravar 'divergente' em `marcarDivergencia`. Esta
-- migration corrige o passado: quem já tem pagamento 'realizado'
-- registrado teve divergência (é o único caminho que cria essa linha —
-- ver src/data/pagamentos.ts) e portanto deveria estar 'divergente'.
--
-- Nenhuma coluna nova, nenhuma mudança de RLS. Só dado.
-- =====================================================================

update public.entregas e
set status_financeiro = 'divergente'
where e.status_financeiro = 'na_ordem'
  and exists (
    select 1 from public.pagamentos p
    where p.entrega_id = e.id
      and p.momento = 'realizado'
  );
