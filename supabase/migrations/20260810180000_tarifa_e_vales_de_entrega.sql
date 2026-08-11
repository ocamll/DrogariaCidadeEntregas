-- =====================================================================
-- Tarifa de entrega, quantidade de vales e quem paga cada um
--
-- Regra real da farmácia, que o sistema não conhecia até agora:
--
-- - A tarifa é FIXA (R$ 9,00 hoje). O caixa nunca digita outro valor.
-- - Endereço distante cobra 2 vales (R$ 18,00).
-- - O vale BASE a farmácia sempre deve à agência. Ela recupera do
--   cliente quando a compra é abaixo de R$ 100 (a taxa entra no valor da
--   compra, que já vem somado do Trier — o sistema não soma nada), e
--   absorve quando é acima. Nos dois casos ela deve os R$ 9 à agência,
--   então isso NÃO muda o acerto e não vira coluna.
-- - O vale EXTRA do endereço distante o cliente paga em mãos ao motoboy:
--   nunca passa pela farmácia. Exceção: convênio marcado como "farmácia
--   paga a entrega inteira" (caso do Minerva), onde ela banca os dois.
--
-- Consequência que motivou tudo: o relatório somava `valor_entrega_cents`
-- como se a farmácia devesse o total. Numa entrega distante ela deve
-- metade — o acerto com a agência estava inflado.
--
--   1 vale            → total 900,  farmácia 900,  cliente 0
--   2 vales           → total 1800, farmácia 900,  cliente 900
--   2 vales + Minerva → total 1800, farmácia 1800, cliente 0
--
-- Tudo em centavos inteiros (regra 1). "Quanto a farmácia deve" é
-- derivado: valor_entrega_cents - entrega_paga_cliente_cents.
-- =====================================================================

-- Por loja, não constante no código: a tarifa muda com o tempo e não
-- deve exigir deploy. Já abre espaço pra filial com tarifa diferente
-- sem migration nova.
alter table public.lojas
  add column if not exists tarifa_entrega_cents integer not null default 900
  check (tarifa_entrega_cents >= 0);

-- Flag por convênio em vez de comparar nome com 'Minerva' no código: se
-- amanhã outro convênio tiver a mesma regra, é só marcar na tela.
alter table public.convenios
  add column if not exists farmacia_paga_entrega_integral boolean not null default false;

-- Guardado explícito, não derivado de valor/tarifa: se a tarifa mudar,
-- dividir o valor de um vale antigo pela tarifa nova daria contagem
-- errada. 0 é válido — transferência entre filiais não tem vale de tele.
alter table public.entregas
  add column if not exists quantidade_vales smallint not null default 1
  check (quantidade_vales >= 0);

-- Quanto do valor da entrega o cliente pagou em mãos ao motoboy. Não dá
-- pra derivar da quantidade porque o convênio integral quebra a regra.
alter table public.entregas
  add column if not exists entrega_paga_cliente_cents integer not null default 0
  check (entrega_paga_cliente_cents >= 0);

-- Transferência não tem vale de tele (valor_entrega_cents já é 0).
update public.entregas set quantidade_vales = 0 where tipo = 'transferencia';

-- Entregas de cliente que já existem ficam com o default 1/0, que é o
-- caso normal e bate com o valor_entrega_cents delas. Nenhuma entrega
-- antiga foi distante — se tivesse sido, ninguém teria como saber, e
-- inventar seria pior que o dado conhecido.
