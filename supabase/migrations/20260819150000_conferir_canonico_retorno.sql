-- =====================================================================
-- CONFERIR O CANÔNICO DO RETORNO — diagnóstico, etapa 2A item 6
--
-- READ-ONLY E INÓCUA. Não cria romaneio, não toca em entrega, não fecha
-- corrida, não grava assinatura. Ela não escreve em tabela nenhuma: só
-- reconstrói o DCRR1 a partir do input e devolve o que produziu.
--
-- ---------------------------------------------------------------------
-- QUE PERGUNTA ELA RESPONDE
-- ---------------------------------------------------------------------
-- Os golden vectors já provaram que os gêmeos concordam — TypeScript
-- 60/60 e SQL 36/36 contra a MESMA terceira referência, escrita à mão
-- antes de ambos. Aquilo não precisa ser reprovado.
--
-- O que sobra é outra pergunta, e os vetores não a alcançam porque rodam
-- dos dois lados DE DENTRO (o TS em Node, o SQL no Editor):
--
--     o caminho supabase-js → PostgREST → jsonb preserva
--     exatamente o input que o navegador assinou?
--
-- É onde moram `undefined` sumindo no `JSON.stringify`, string vazia
-- virando nulo, número chegando como string, ordem de array mudando,
-- Unicode atravessando quatro camadas, e UUID vindo do banco numa
-- representação inesperada.
--
-- ---------------------------------------------------------------------
-- POR QUE ELA DEVOLVE OS TRÊS, E NÃO SÓ O TEXTO
-- ---------------------------------------------------------------------
-- `octet_length` e `digest` são calculados AQUI, sobre o texto que o
-- Postgres produziu — antes de ele voltar pela rede. Se o navegador
-- recebesse só o texto e contasse os bytes lá, o transporte de VOLTA
-- entraria silenciosamente na conta.
--
-- Com os três, uma divergência tem assinatura legível:
--
--   texto difere, bytes e hash iguais   -> o transporte de volta mexeu
--   bytes diferem                       -> codificação, não conteúdo
--   os três diferem                     -> o input chegou diferente
--
-- ---------------------------------------------------------------------
-- Ela sobrevive à etapa 2B de propósito: quando `selar_romaneio_retorno`
-- existir, esta continua sendo o jeito de perguntar "o que o servidor
-- entendeu do que eu mandei?" sem selar nada.
-- =====================================================================

create or replace function public.conferir_canonico_retorno(
  p_saida_id uuid,
  p_saida_document_hash text,
  p_motoboy_id uuid,
  p_responsavel_id uuid,
  p_retorno jsonb
)
returns table (
  canonico text,
  bytes    integer,
  sha256   text
)
language sql stable security invoker
set search_path = public, extensions
as $$
  select c,
         octet_length(c),
         encode(digest(c, 'sha256'), 'hex')
    from public.romaneio_retorno_canonico(
           p_saida_id, p_saida_document_hash,
           p_motoboy_id, p_responsavel_id, p_retorno
         ) as c;
$$;

revoke all on function public.conferir_canonico_retorno(uuid, text, uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.conferir_canonico_retorno(uuid, text, uuid, uuid, jsonb)
  to authenticated;
