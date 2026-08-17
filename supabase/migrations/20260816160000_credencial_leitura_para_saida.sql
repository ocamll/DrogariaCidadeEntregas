-- =====================================================================
-- O caixa precisa enxergar QUAIS cartões existem — só isso
--
-- Etapa 5. A policy da etapa 2 restringia a leitura de
-- `motoboy_credenciais` ao admin, o que fazia sentido enquanto a única
-- tela era a de emissão. Com a Nova Corrida offline, não faz mais:
--
-- Sem rede, o navegador precisa resolver o `public_id` bipado no cartão
-- para um nome ("João Silva · Ágil Motos") a partir de um cache local. E
-- pra ter esse cache, o caixa precisa ter conseguido LER a lista alguma
-- vez enquanto estava online. Com a policy de admin, ele nunca lê, o
-- cache nasce vazio, e bipar offline não identifica ninguém.
--
--
-- POR QUE ISSO NÃO AFROUXA NADA
--
-- Quem protege `token_hash` e `pin_hash` não é esta policy — é o GRANT
-- por coluna da etapa 2, que simplesmente não os inclui. O privilégio
-- não existe para `authenticated`, então nenhuma policy, por mais larga,
-- consegue devolvê-los. A policy governa QUAIS LINHAS aparecem; o grant
-- governa QUAIS COLUNAS. São perguntas diferentes, e é justamente essa
-- distinção que o projeto levou duas sessões pra aprender.
--
-- O que o caixa passa a ver é: que motoboy tem cartão ativo, desde
-- quando, se já criou PIN e se está bloqueado. Ele já enxerga a lista de
-- motoboys inteira (a leitura de `mototaxistas` sempre foi ampla no
-- tenant, senão "Nova corrida" não funcionaria), então isso não conta
-- nada de novo sobre ninguém.
--
-- A ESCRITA NÃO MUDA. Emitir, revogar e redefinir continuam sendo
-- funções SECURITY DEFINER que exigem `is_admin()` por dentro, e
-- continua não existindo grant de INSERT/UPDATE/DELETE nesta tabela.
-- =====================================================================

drop policy motoboy_credenciais_select on public.motoboy_credenciais;

create policy motoboy_credenciais_select on public.motoboy_credenciais
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
