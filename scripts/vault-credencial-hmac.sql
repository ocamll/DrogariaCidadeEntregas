-- =====================================================================
-- Segredo do HMAC das credenciais de motoboy
--
-- NÃO É MIGRATION. Roda UMA vez, à mão, no SQL Editor do Supabase.
--
--   Dashboard → seu projeto → SQL Editor (barra lateral esquerda)
--   → New query → cola isto → Run
--
-- É o mesmo lugar onde as migrations deste projeto são aplicadas.
--
--
-- POR QUE ISTO NÃO É UMA MIGRATION
--
-- Migration descreve ESTRUTURA, e estrutura vive no repositório. Isto é um
-- SEGREDO: se estivesse numa migration, estaria no git. O banco guarda o
-- segredo; o repositório guarda só a instrução de criá-lo.
--
--
-- POR QUE GERAR DENTRO DO BANCO
--
-- O `select` abaixo gera o valor no próprio servidor. Assim ele nunca
-- passa por arquivo, por chat, pela área de transferência nem pelo
-- histórico do seu terminal. Ninguém — inclusive quem escreveu isto —
-- chega a ver o segredo.
--
--
-- SINTOMA DE NÃO TER RODADO
--
--   "Segredo credencial_hmac ausente no Vault"
--
-- ao emitir a primeira credencial. As migrations rodam sem erro nenhum
-- mesmo sem este passo, porque a função que lê o segredo só falha quando
-- é chamada — por isso o erro aparece longe da causa.
-- =====================================================================


-- 1. Garante a extensão do Vault. Em projeto Supabase ela normalmente já
--    está; o `if not exists` torna isto seguro de rodar de qualquer jeito.
create extension if not exists supabase_vault with schema vault;


-- 2. Cria o segredo.
--
--    Dois `gen_random_uuid()` concatenados dão 64 caracteres hex (~244
--    bits). Usa isso em vez de `gen_random_bytes` de propósito:
--    `gen_random_uuid` é função nativa do Postgres, enquanto
--    `gen_random_bytes` vem do pgcrypto — que mora em `public` numa
--    instalação e em `extensions` noutra. Assim não depende de qual é a
--    sua.
select vault.create_secret(
  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  'credencial_hmac',
  'HMAC das credenciais fisicas de motoboy'
);


-- 3. Confere, sem revelar o valor.
--    A primeira linha mostra que o segredo existe; a segunda prova que a
--    função do app consegue lê-lo. `tamanho_do_segredo` tem que dar 64.
select name, created_at from vault.secrets where name = 'credencial_hmac';
select length(public.segredo_credencial()) as tamanho_do_segredo;


-- =====================================================================
-- SE DER ERRO
--
-- "duplicate key" / "already exists"
--   O segredo já existe. Nada a fazer — pula pro passo 3 e confere.
--
-- "function vault.create_secret(...) does not exist"
--   A extensão não subiu. Dá pra criar pelo formulário do dashboard:
--   Project Settings → Vault → Add new secret, com name
--   `credencial_hmac` e um valor aleatório longo (64 caracteres hex).
--   Nesse caminho o valor passa pela sua área de transferência, o que é
--   pior — só use se o passo 1 falhar mesmo.
--
-- "permission denied for schema vault"
--   O SQL Editor está rodando como um papel sem acesso. Confirme que
--   está no editor do dashboard (que roda como `postgres`), e não numa
--   conexão externa com outro usuário.
--
--
-- ROTAÇÃO
--
-- Trocar este segredo INVALIDA todos os cartões já emitidos — o
-- `token_hash` guardado foi calculado com o segredo antigo e não vai mais
-- bater. Todos os motoboys precisariam de cartão novo. Não rotacione sem
-- essa intenção.
--
-- (Não confundir com a rotação das chaves RSA da fila offline, que é
-- outra coisa e tem período de graça — ver ROMANEIO_KEYS no CLAUDE.md.)
-- =====================================================================
