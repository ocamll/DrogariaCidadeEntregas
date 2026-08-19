-- =====================================================================
-- Só o token v3 passa a ser reconhecido
--
-- Decisão do usuário em 2026-08-18: v1 (`DCM1.<10>.<20>` base32) e v2
-- (`2<10><31>` numérico) foram versões de teste, emitidas antes do
-- formato definitivo. Nenhum cartão daqueles chegou a circular na
-- farmácia, então reconhecê-los só mantinha três caminhos vivos onde a
-- operação tem um.
--
--   3      versão (1 dígito)
--   012345 public_id (6 dígitos)
--   1234…  segredo (15 dígitos ≈ 50 bits)
--          ────────────────────────────
--          22 dígitos, sem separador
--
--
-- O QUE CONFERIR ANTES DE APLICAR
--
-- Credencial ATIVA com public_id fora do formato v3 deixa de ser
-- reconhecida — o cartão físico dela para de funcionar. Rode antes:
--
--   select c.public_id, m.nome, length(c.public_id) as digitos
--     from public.motoboy_credenciais c
--     join public.mototaxistas m on m.id = c.motoboy_id
--    where c.ativo and c.public_id !~ '^[0-9]{6}$';
--
-- Zero linhas = seguro. Alguma linha = aquele motoboy precisa de cartão
-- novo ANTES desta migration, senão ele chega no balcão com um cartão
-- que o sistema não conhece mais.
--
-- Conferido em 2026-08-18: as duas credenciais ativas (João Silva
-- `171233` e Carlos Teste `066632`) já são v3. As antigas, de 10 dígitos,
-- estão todas revogadas — emitir cartão novo revoga o anterior, então
-- elas já não autenticavam de qualquer jeito.
--
--
-- AS LINHAS ANTIGAS NÃO SÃO APAGADAS
--
-- `motoboy_credenciais` continua com as credenciais revogadas de
-- public_id longo. Elas são histórico: dizem quando um cartão foi
-- emitido, por quem e quando foi revogado, e o Registro de Auditoria
-- referencia esses eventos. O que muda é só o parser deixar de casar um
-- token daquele formato — nada é destruído.
--
--
-- O GÊMEO NO CLIENTE MUDA JUNTO
--
-- `publicIdDoToken`, em `src/lib/tokenCartao.ts`, é a cópia desta função
-- e responde sozinho pelo reconhecimento OFFLINE. Os dois mudam sempre
-- juntos: divergirem não dá erro claro, dá "o cartão não é reconhecido
-- quando falta internet", meses depois. Coberto por
-- `npx tsx scripts/tokenCartao.spec.mts`.
-- =====================================================================

create or replace function public.public_id_do_token(p_token text)
returns text language sql immutable set search_path = public as $$
  select case
    -- v3: 1 + 6 + 15 = 22 dígitos, sem separador. Ponto no meio quebraria
    -- o modo numérico do Code 128 e o código deixaria de caber no cartão.
    when p_token ~ '^3[0-9]{21}$'
      then substr(p_token, 2, 6)
    else null
  end;
$$;

-- Pra conferir depois de aplicar:
--
--   select public.public_id_do_token('3' || repeat('7',21));  -- '777777'
--   select public.public_id_do_token('2' || repeat('7',41));  -- null (v2)
--   select public.public_id_do_token('DCM1.0102030405.' || repeat('A',20));  -- null (v1)
--   select public.public_id_do_token('3' || repeat('7',20));  -- null
