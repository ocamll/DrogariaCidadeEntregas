-- =====================================================================
-- Cadastros (agências, mototaxistas, convênios) viram exclusivos do admin
--
-- Decisão do usuário em 2026-08-12: gestor não tem acesso a Cadastros.
-- Antes a escrita era liberada por `is_gerente()`, ou seja, gerente
-- também criava e editava agência, mototaxista e convênio.
--
-- Só a ESCRITA fecha. O SELECT continua amplo no tenant de propósito,
-- porque não é tela de administração — é operação: "Nova corrida"
-- precisa listar agências e motoboys pro caixa escolher, e o cadastro de
-- entrega precisa dos convênios no select. Fechar a leitura quebraria o
-- fluxo do balcão sem proteger nada que já não esteja protegido (nome de
-- agência não é dado sensível; vale, pagamento e assinatura, que são,
-- estão escopados por filial na migration anterior).
--
-- A aba "Cadastros" também sai da tela do gerente, mas isso é UI: quem
-- de fato barra é esta policy. Frontend esconde botão, RLS impede query.
--
-- ATENÇÃO ao `with check`: numa policy `for all`, o `using` governa
-- SELECT/UPDATE/DELETE e o `with check` governa INSERT (e a linha NOVA do
-- UPDATE). A policy original tinha `with check (tenant_id = ...)` só, sem
-- papel nenhum — ou seja, qualquer autenticado do tenant conseguia
-- INSERIR agência, mototaxista e convênio, mesmo sem poder editar depois.
-- Por isso `is_admin()` aparece nos DOIS lados aqui: restringir só o
-- `using` fecharia a edição e deixaria a criação aberta.
-- =====================================================================

drop policy agencias_write on public.agencias;
create policy agencias_write on public.agencias for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_admin())
  with check (tenant_id = public.current_tenant_id() and public.is_admin());

drop policy mototaxistas_write on public.mototaxistas;
create policy mototaxistas_write on public.mototaxistas for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_admin())
  with check (tenant_id = public.current_tenant_id() and public.is_admin());

drop policy convenios_write on public.convenios;
create policy convenios_write on public.convenios for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_admin())
  with check (tenant_id = public.current_tenant_id() and public.is_admin());
