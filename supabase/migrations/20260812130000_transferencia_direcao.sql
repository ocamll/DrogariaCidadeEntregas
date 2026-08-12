-- =====================================================================
-- Transferência: a direção estava invertida
--
-- Como funciona de verdade (confirmado com o usuário em 2026-08-12): a
-- filial que está SEM o produto é quem pede. O motoboy vai primeiro na
-- filial que tem, pega o produto, entrega na filial que pediu, e é lá que
-- ele assina e recolhe o vale.
--
-- Ou seja, quem opera a tela é a filial que RECEBE, e a filial escolhida
-- no select é a que FORNECE. O sistema gravava o contrário: a escolhida
-- ia pra `loja_destino_id` e a rota saía como "quem pediu para quem
-- forneceu" — invertida em todas as transferências já lançadas.
--
-- O que já estava certo e não muda: `loja_id` continua sendo a filial
-- dona do vale, que é a que pede, recebe e paga a tele. Por isso a tarifa
-- sai da loja de quem cria, e por isso a RLS e o relatório continuam
-- escopando o vale nela.
--
-- O que muda aqui é o NOME da coluna, que afirmava o oposto do que ela
-- guarda. Só dado de teste hoje; renomear depois do deploy sairia caro.
-- =====================================================================

alter table public.entregas rename column loja_destino_id to loja_origem_id;

-- o CHECK carregava "destino" no nome pelo mesmo motivo
alter table public.entregas drop constraint entregas_transferencia_tem_destino;
alter table public.entregas add constraint entregas_transferencia_tem_origem check (
  tipo <> 'transferencia' or loja_origem_id is not null
);

-- --- dado: corrige a rota das transferências já lançadas ---------------
-- `cliente_nome` passa a ser a filial que recebe (mesma lógica do vale de
-- cliente: "cliente" é quem recebe a entrega) e `cliente_endereco` passa a
-- ler "fornecedora para solicitante".
--
-- O `not exists` NÃO é otimização: vale com assinatura tem cliente e valor
-- congelados pela trigger fn_entrega_imutavel (regra 7), e contornar isso
-- é proibido. Os assinados ficam com a rota antiga — são de teste e somem
-- na limpeza que antecede o uso real.
update public.entregas e
set cliente_nome = solicitante.nome,
    cliente_endereco = fornecedora.nome || ' para ' || solicitante.nome
from public.lojas fornecedora, public.lojas solicitante
where e.tipo = 'transferencia'
  and fornecedora.id = e.loja_origem_id
  and solicitante.id = e.loja_id
  and not exists (
    select 1 from public.assinaturas a where a.corrida_id = e.corrida_id
  );
