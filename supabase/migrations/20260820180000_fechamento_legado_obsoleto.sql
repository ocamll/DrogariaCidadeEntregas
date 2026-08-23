-- =====================================================================
-- 2C.2 — O FECHAMENTO LEGADO NÃO PODE CONTRADIZER UM DCRR1 SELADO
--
-- O cenário destrutivo, e ele não é hipotético:
--
--     retorno sela → corrida fecha → `fechamento_corrida` legado da fila
--     chega DEPOIS → reescreve o desfecho → o banco passa a dizer algo
--     diferente do documento que as duas partes assinaram.
--
-- Só UMA das duas ordens é destrutiva. Fechamento antes do retorno dá
-- `corrida_ja_fechada` → conflito, prova preservada, caro mas seguro (a
-- 2B já previu isso). Retorno antes do fechamento é a regra 7 violada por
-- escrita tardia, **sem erro nenhum**.
--
-- ---------------------------------------------------------------------
-- POR QUE TRIGGER, E NÃO UM GUARD NA RPC
--
-- Porque `fecharCorrida` NÃO É RPC. É um laço de UPDATEs diretos em
-- `entregas` mais um UPDATE em `corridas`, pelo PostgREST — não existe
-- função onde pôr o guard.
--
-- Isso não enfraquece o argumento, fortalece: a proteção precisa valer
-- para fila antiga em outro computador, outra sessão, um navegador dias
-- offline e até uma chamada de cliente antigo. Guard em RPC jamais
-- cobriria o último. A ordenação da fila (`dependeDeChave`) continua
-- valendo como otimização e UX; a última linha de defesa da regra 7 tem
-- que estar aqui.
--
-- O precedente é `fn_entrega_protege_conferencia`, que existe pelo mesmo
-- motivo: a escrita precisa ficar aberta e RLS não restringe coluna.
--
-- ---------------------------------------------------------------------
-- COMO O SELO DO RETORNO NÃO BLOQUEIA A SI MESMO
--
-- Esta é a armadilha do item 34, e ela mata a versão ingênua deste
-- trigger. `selar_romaneio_retorno_interno` grava nesta ordem:
--
--     insert romaneios (tipo='retorno', status='selado')   ← já existe
--     insert romaneio_entregas
--     update entregas   (desfecho, motivo, observações)    ← AQUI
--     update corridas   status = 'fechada'                 ← só no fim
--
-- Um trigger que perguntasse "existe retorno selado pra esta corrida?"
-- dispararia durante o PRÓPRIO selo e bloquearia todo retorno — *toda
-- saída falharia, com o erro apontando pro lugar errado*.
--
-- O discriminador é a CORRIDA JÁ ESTAR FECHADA. Durante o selo ela ainda
-- está aberta (o `update corridas` é o último passo); depois dele, está
-- fechada. E o par "existe retorno selado E a corrida está fechada" não é
-- um truque: é a definição de **o documento está pronto**.
--
-- Isso vale mais que um flag de sessão ou um `set local`, porque não
-- exige reabrir `selar_romaneio_retorno_interno` — que já tem duas
-- definições no repositório e é a função mais delicada desta frente.
--
-- **CONSEQUÊNCIA A PRESERVAR:** se alguém um dia mover o
-- `update public.corridas` do fim do interno para antes do laço de
-- entregas, este trigger passa a bloquear o próprio selo. Está amarrado,
-- e é o mesmo tipo de acoplamento que a saída já carrega desde o item 34.
--
-- ---------------------------------------------------------------------
-- O QUE CONGELA, E O QUE NÃO PODE CONGELAR
--
-- Exatamente as três colunas que o DCRR1 afirma:
--
--     status_entrega     o desfecho
--     insucesso_motivo   o motivo
--     observacoes        o detalhe
--
-- E nada além. Congelar demais quebraria dois fluxos que o desenho
-- preserva de propósito:
--
--     status_documental   o convênio volta DIAS depois, pela aba
--                         Documentos, e o retorno já recomputou o valor
--     status_financeiro   `marcarDivergencia` continua existindo pro que
--                         se descobre DEPOIS do retorno selado
--
-- **ISTO NÃO CONTRADIZ A REGRA 7, e alguém vai achar que sim.** A regra 7
-- lista status, observações e motivo de insucesso como MUTÁVEIS depois da
-- saída — e está certa, porque a saída não afirma desfecho. O retorno
-- afirma. É a mesma regra aplicada ao segundo documento.
--
-- Efeito colateral declarado: a "correção cadastral por evento"
-- (categoria 1 da regra 7, ainda não construída) lista `observacoes`
-- entre os campos corrigíveis. Em vale com retorno selado ela passa a não
-- alcançar essa coluna. É o certo — ali `observacoes` carrega o detalhe
-- assinado —, mas quem for construir aquilo precisa saber.
--
-- ---------------------------------------------------------------------
-- O ERRO PRECISA SER CLASSIFICÁVEL, E A AUDITORIA NÃO PODE SER DAQUI
--
-- Só levantar exceção põe o item legado em `erro` e no backoff PRA
-- SEMPRE — o pior sintoma conhecido do projeto (§50.4). O handler legado
-- (2C.8) tem que reconhecer este SQLSTATE, marcar o item TERMINAL pelo
-- mecanismo que já existe (`ErroTerminalDeSaida`) e gravar a auditoria
-- `fechamento_legado_obsoleto`.
--
-- **A auditoria tem que ser gravada PELO CLIENTE, nunca aqui dentro.**
-- Um `insert into eventos` antes do `raise` seria desfeito pelo próprio
-- rollback que o `raise` provoca — o evento nunca existiria, e quem
-- lesse o código concluiria que existe.
--
-- O SQLSTATE é `DCRR1`. **CONFIRA O VALOR MEDIDO na conferência antes de
-- escrever o handler**, e use o que o banco devolver, não o que está
-- escrito aqui: na 2C.1 eu previ `02000` para `no_data_found` e o banco
-- devolveu `P0002`. Adivinhar SQLSTATE já custou uma correção nesta
-- frente.
-- =====================================================================

create or replace function public.fn_entrega_protege_desfecho_selado()
returns trigger language plpgsql set search_path = public as $$
declare
  v_numero text;
begin
  -- Sai na primeira linha em todo UPDATE que não encosta nas três
  -- colunas do DCRR1 — que são a esmagadora maioria: cadastro, custódia
  -- de papel, conferência, divergência, cancelamento.
  if new.status_entrega   is not distinct from old.status_entrega
 and new.insucesso_motivo is not distinct from old.insucesso_motivo
 and new.observacoes      is not distinct from old.observacoes then
    return new;
  end if;

  -- Vale sem corrida nunca teve retorno.
  if old.corrida_id is null then
    return new;
  end if;

  -- O par que define "o documento está pronto". Durante o selo do
  -- retorno a corrida ainda está ABERTA, então isto não encontra nada e
  -- o próprio selo passa — ver o cabeçalho.
  select r.numero into v_numero
    from public.romaneios r
    join public.corridas c on c.id = r.corrida_id
   where r.corrida_id = old.corrida_id
     and r.tipo   = 'retorno'
     and r.status = 'selado'
     and c.status = 'fechada';

  if v_numero is null then
    return new;
  end if;

  raise exception
    'Desfecho já selado no romaneio de retorno %: este vale não pode ser reescrito.',
    v_numero
    using errcode = 'DCRR1',
          detail  = format(
            'vale %s, corrida %s. Tentaram gravar desfecho=%s motivo=%s.',
            old.numero_vale, old.corrida_id,
            coalesce(new.status_entrega, '-'), coalesce(new.insucesso_motivo, '-')),
          hint    = 'Fechamento legado obsoleto: o retorno já registrou o desfecho. '
                    'Marque a operação da fila como terminal em vez de retentar.';
end;
$$;

drop trigger if exists trg_entregas_desfecho_selado on public.entregas;

create trigger trg_entregas_desfecho_selado
  before update on public.entregas
  for each row
  execute function public.fn_entrega_protege_desfecho_selado();

-- =====================================================================
-- CONFERÊNCIA: `scripts/conferir-2c2-no-sql-editor.sql`
--
-- O bloco 2 de lá é o que importa — guarda que não se prova contra o
-- defeito que a motivou é decoração. Ele monta um retorno selado
-- sintético, prova que o desfecho trava e que `status_financeiro`
-- continua livre, e desfaz tudo.
--
-- **Não há retorno selado real ainda** (o placar diz `retorno 0 · 0 · 0`),
-- então o caminho positivo só existe sintético até a 2D.
-- =====================================================================
