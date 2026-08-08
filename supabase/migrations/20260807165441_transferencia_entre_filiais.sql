-- =====================================================================
-- Vale de transferência entre filiais.
--
-- Não é uma tabela nova: é o mesmo "vale" que a entrega de cliente —
-- mesmo número sequencial, mesmo ciclo de status/corrida/assinatura na
-- retirada (um motoboy fisicamente leva o produto de uma filial à
-- outra). O que muda é que não tem cliente real nem valor de venda.
--
-- loja_id (já existe) = filial de origem, quem criou o vale.
-- loja_destino_id (novo) = pra onde vai.
-- cliente_nome / cliente_endereco continuam not null — pra transferência
-- são preenchidos no código com o nome da filial destino e a rota
-- ("Filial 10 para Filial 2"), não digitados à mão. Evita relaxar
-- constraint e mexer em tudo que já lê esses dois campos.
-- =====================================================================

alter table public.entregas
  add column tipo text not null default 'cliente' check (tipo in ('cliente', 'transferencia'));

alter table public.entregas
  add column loja_destino_id uuid references public.lojas(id);

alter table public.entregas
  alter column valor_compra_cents set default 0;

alter table public.entregas add constraint entregas_transferencia_tem_destino check (
  tipo <> 'transferencia' or loja_destino_id is not null
);
