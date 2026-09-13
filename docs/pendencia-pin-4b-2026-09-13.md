# Pedidos de credencial — PIN esquecido e cartão perdido

13/09/2026, **versão 2, proposta, nada aplicado por esta sessão.** Fecha o §5 do
[desenho do 4B](desenho-4b-2026-09-11.md): *quando o gerente autoriza no lugar do
motoboy, o admin precisa ter onde acompanhar a providência.*

A versão 1 foi revisada pelo usuário no mesmo dia, conferindo este documento e as
migrations. **A revisão estava certa nos seis pontos**, e três deles eram afirmações
minhas feitas sem medir:

| # | versão 1 | o que a revisão mostrou | versão 2 |
|---|---|---|---|
| 1 | "só `log_credencial` escreve os eventos de PIN"; o pedido nascia de uma linha inserida em `assinaturas` | a policy `eventos_insert` aceita **qualquer tipo** do tenant, e `assinaturas_insert` ainda permite inserção direta. Nem o nome do evento nem a existência da assinatura provam o fato | os fatos vêm de tabelas **sem escrita pelo cliente**: `motoboy_autorizacoes`, `romaneios` e a própria `motoboy_credenciais` (§2) |
| 2 | o relógio do balcão decidia "chegou depois", com uma ressalva escrita | escrever a ressalva não resolve; e há um caso que falha **com os relógios certos**: reset às 10h, operação offline das 8h sincronizando às 11h → pedido novo para problema resolvido | **o relógio do servidor pode encerrar; o do balcão só pode rebaixar para "Verificar"** (§4) |
| 3 | gatilho `after insert` na transação do selo, com índice único | concorrência mal tratada vira exceção, e exceção desfaz a SAÍDA ou o RETORNO | **nenhum gatilho no caminho do selo**: o pedido é DERIVADO na leitura (§3) |
| 4 | só horário e autor da resolução; admin "encerra" sem ter como | sem vínculo com a credencial não se distinguem redefinições sucessivas nem troca de cartão | fatos com `credencial_id`; encerramento manual com motivo, sem zerar PIN (§6) |
| 5 | comentário "gerente vê a filial" com `loja_id = current_loja_id()` | a condição inclui o **caixa** por acidente | abrangência explícita por cargo (§7) |
| 6 | "O admin foi avisado" | gravar no banco não prova aviso, e não havia como outra sessão receber | "Pedido registrado no painel do administrador"; atualização declarada (§8) |

E a regra que ficou ausente: **o pedido, sozinho, não retém vale, não muda atribuição e
não desfaz selo** (§9).

---

## 1. O que existe no banco hoje — e o que fazer primeiro

Medido pelo usuário em 13/09, sem alterar nada:

- **as duas tabelas da versão 1 já existem, vazias, fora de qualquer migration**: não há
  arquivo delas em `supabase/migrations/`. A explicação mais provável é o bloco de SQL da
  mensagem ter sido executado — e **o erro de origem é meu**: mostrei as duas
  `create table` num bloco próprio, separadas do `enable row level security` e dos
  `revoke`, que ficaram só neste documento. Um bloco copiável não pode sair sem a
  proteção dele;
- nenhuma função, policy ou publicação de tempo real as referencia;
- existem **5 assinaturas com `pin_esquecido`**, sem acompanhamento nenhum.

**Tabela nova no Supabase nasce com permissão total para `anon` e `authenticated`.** Sem
RLS, qualquer um com a chave pública lê e escreve nelas. Estão vazias e nada as usa, mas
a porta está aberta. **A versão 2 não usa essas tabelas**, então o certo é removê-las:

```sql
-- (a) CONFERIR — só leitura
select c.relname,
       c.relrowsecurity                                           as rls_ligada,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       has_table_privilege('anon', c.oid, 'insert')               as anon_insere,
       has_table_privilege('authenticated', c.oid, 'insert')      as autenticado_insere
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('pendencias_credencial', 'pendencia_credencial_operacoes');

select (select count(*) from public.pendencias_credencial)          as pedidos,
       (select count(*) from public.pendencia_credencial_operacoes) as operacoes;

-- (b) REMOVER — só se as duas contagens de (a) forem 0
drop table public.pendencia_credencial_operacoes;
drop table public.pendencias_credencial;
```

A migration da versão 2 repete a remoção com guarda (recusa se houver linha), para o
repositório voltar a descrever o banco.

---

## 2. A origem dos fatos — só o que o cliente não consegue escrever

Conferido nas migrations:

| Fato | Onde | Por que é confiável |
|---|---|---|
| **o gerente autorizou por um motivo** | `motoboy_autorizacoes` com `validador_profile_id` e `motivo_excecao` | RLS ligada, `revoke all` de `anon`/`authenticated`, **nenhum grant**: só as funções `SECURITY DEFINER` de autorização gravam. Guarda o **motoboy da operação** em `motoboy_id` e o cartão do gerente em `credencial_id` |
| **a operação aconteceu** | a autorização consumida (`consumida_por_romaneio`) por um `romaneios` com `status = 'selado'` | `romaneios` só tem `grant select` |
| **o PIN foi zerado, cadastrado; o cartão foi emitido, revogado** | **tabela nova** `credencial_fatos`, preenchida por gatilho em `motoboy_credenciais` | `motoboy_credenciais` não tem grant de escrita (só `select` de colunas). `pin_hash` só muda em `definir_pin`, `redefinir_pin` e `redefinir_meu_pin`; `autenticar_credencial_interno` não reescreve o hash |

**Nem `eventos` nem `assinaturas` entram na decisão.** Os eventos `credencial_pin_*`
continuam existindo para a auditoria, e aparecem no painel só como **indício não
comprovado** nos casos anteriores ao acompanhamento (§10).

**O gatilho de fatos não fica no caminho do selo.** A autenticação atualiza
`tentativas_pin` na mesma linha durante a sincronização, mas o gatilho tem
`when (old.pin_hash is distinct from new.pin_hash or old.ativo is distinct from new.ativo)`:
com a condição falsa a função nem é chamada.

---

## 3. Nenhum gatilho no selo: o pedido é DERIVADO

Não existe linha de "pedido" criada no selo. Uma função `SECURITY DEFINER`,
`pedidos_de_credencial()`, calcula os pedidos na leitura a partir dos fatos do §2.

O que isso compra, e é o motivo da escolha:

- **concorrência deixa de existir no selo**: duas sincronizações simultâneas do mesmo
  motoboy gravam duas autorizações, como já gravam hoje; não há `insert` disputado;
- **nenhuma falha de acompanhamento desfaz uma saída ou um retorno**;
- **reenvio não duplica por construção**: a autorização é consumida uma vez;
- **retroativo de graça**: as 5 exceções existentes aparecem sem backfill (§10);
- a regra fica **num lugar só**, e muda sem migrar dado.

As únicas escritas novas são as do §2 (fatos da credencial, no caminho de definir e
redefinir PIN) e a do encerramento manual (§6).

---

## 4. Os estados, e a regra dos dois relógios

Cada exceção tem um **limite superior no relógio do servidor**, o instante antes do qual
ela certamente aconteceu:

| modo | limite superior | limite inferior |
|---|---|---|
| online | `motoboy_autorizacoes.criada_em` — o instante exato da validação do PIN | o mesmo |
| offline | `romaneios.recebido_em_servidor` — a sincronização | **desconhecido**; o balcão diz `ocorrido_em_local` |

**A regra:** *o relógio do servidor pode encerrar; o do balcão só pode rebaixar de
"aberto" para "Verificar". Nunca encerra, nunca pede outro reset.*

Para cada exceção `e` do motoboy:

```
resolve(e)   = primeiro fato de ativação (PIN cadastrado — ou, no cartão perdido,
               cartão emitido e PIN cadastrado nele) numa credencial do PRÓPRIO
               motoboy, com  fato.em > limite_superior(e)

ambígua(e)   = e é offline, e existe fato de ativação do motoboy com
               ocorrido_em_local(e) − TOLERÂNCIA  <  fato.em  ≤  recebido_em_servidor(e)
```

Exceções com o mesmo `resolve` formam um pedido. Estado do pedido:

| estado | quando | na tela |
|---|---|---|
| `aguardando_admin` | nenhum fato depois das exceções | "Redefinir PIN de João Silva" |
| `pin_zerado` | PIN zerado depois das exceções, sem cadastro | "PIN zerado — falta o motoboy cadastrar o novo, com o cartão, online" |
| `atendido` | fato de ativação depois de **todas** as exceções do pedido, pelo servidor | "Atendido em …", com a credencial e o fato que resolveu |
| `verificar` | há exceção ambígua ou anterior ao acompanhamento | "Verificar se o problema persiste", com a evidência |
| `encerrado` | o admin encerrou com motivo (§6) | "Encerrado por … — motivo" |

**O caso da revisão, pela regra:** autorização offline às 8h, PIN cadastrado às 10h,
sincronização às 11h. O fato das 10h é anterior ao limite superior (11h), então **não
resolve**; está dentro da janela da ambiguidade, então **Verificar**, com a evidência dos
dois fatos. Não abre um pedido de reset, e não encerra sozinho.

**Novo esquecimento depois de atendido:** exceção ONLINE às 15h, com o PIN cadastrado às
10h → limite superior 15h > 10h → pedido novo, **aguardando o admin**. Sem ambiguidade,
porque o servidor sabe a hora.

**`TOLERÂNCIA`** é uma constante da função — proposta: **24 horas**. Ela só alarga o que
vai para "Verificar"; errar para mais custa uma conferência humana, nunca um
encerramento indevido.

**"Credencial do próprio motoboy":** o fato é de uma credencial com `motoboy_id` igual ao
da exceção. **Cartão novo com PIN cadastrado resolve PIN esquecido** — o motoboy voltou a
ter PIN válido. O cartão do gerente nunca resolve pedido de motoboy.

---

## 5. Cartão perdido — pedido próprio, sem revogação automática

Mesmo mecanismo, tipo `reemitir_cartao`, confirmado pelo usuário na revisão:

| estado | quando |
|---|---|
| `aguardando_admin` | nenhum cartão novo emitido para o motoboy depois da exceção |
| `cartao_emitido` | cartão novo emitido, sem PIN cadastrado nele |
| `atendido` | PIN cadastrado **no cartão emitido depois da exceção** |

**Nada revoga o cartão automaticamente** ao registrar a exceção. Emitir o cartão novo já
revoga o anterior (`emitir_credencial_interno`), e esse é o ato do admin.

---

## 6. O encerramento pelo admin — sem zerar o PIN atual

Para o alerta reconhecidamente antigo, ou o "Verificar" em que o admin confirmou com o
motoboy que o PIN funciona:

- RPC `encerrar_pedido_de_credencial(p_autorizacao_ids uuid[], p_motivo text)`;
- **só admin**, do tenant; motivo obrigatório;
- grava **uma linha por autorização** (chave primária = a autorização), com quem, quando e
  o motivo. Repetir o clique não duplica (`on conflict do nothing`);
- **não toca na credencial**: não zera PIN, não revoga cartão;
- encerra só as exceções listadas. Uma exceção que sincronize depois continua sujeita ao
  §4: a hora do encerramento conta como fato para a ambiguidade, então ela vai para
  "Verificar", não para um pedido novo silencioso.

---

## 7. Quem vê — explícito, por cargo

A leitura é pela função, que resolve o cargo pela sessão:

| cargo | vê |
|---|---|
| admin | todos os pedidos do tenant |
| gerente | os pedidos com alguma operação **na filial dele** |
| caixa | **nenhum** — o painel não é dele. A tela da própria operação diz o que foi registrado (§8) |

As tabelas novas ficam com RLS ligada, `revoke all`, **sem policy de leitura direta**:
nada chega a elas fora da função. É a mesma forma de `motoboy_autorizacoes`.

---

## 8. O aviso — o que a tela pode afirmar

| onde | texto |
|---|---|
| fim da saída ou do retorno com o gerente, **online** | "Pedido registrado no painel do administrador." |
| idem, **offline** | "O pedido será registrado no painel do administrador quando este registro sincronizar." |
| painel do admin (Cadastros › Credenciais) | a lista, com estado e evidência |
| cabeçalho do admin | a contagem de pedidos **não atendidos nem encerrados** |

**Nada de "o admin foi avisado".** Sem tempo real, o que existe é:

- **outra sessão** vê o pedido ao abrir a tela, ao voltar o foco à janela e **a cada 60
  segundos** com a tela aberta (`refetchInterval`);
- **depois de reconectar**, a primeira consulta traz tudo, porque o pedido é derivado de
  fatos no banco e não de uma notificação entregue;
- **o pedido continua aparecendo nos dias seguintes** até atendido ou encerrado — não é o
  aviso do dia de "Notificações";
- **abrir ou ler não encerra** nada.

Tempo real pode vir depois. Se vier, o texto muda junto; antes disso, não.

---

## 9. O que o pedido NÃO faz

- **não retém vale** cuja operação foi validamente autorizada pelo gerente;
- **não muda a atribuição**: o vale continua no motoboy da operação;
- **não desfaz nem marca o selo**, e não entra em hash nenhum;
- **não bloqueia o motoboy** nem o cartão.

---

## 10. Os casos anteriores ao acompanhamento

A migration grava, no instante em que é aplicada, uma **linha de base** em
`credencial_fatos` para cada credencial ativa de motoboy (`inicio_com_pin` ou
`inicio_sem_pin`). Antes dela não há fato confiável de PIN.

Então **toda exceção anterior à linha de base cai em "Verificar"**, com:

- a evidência da operação (romaneio, filial, gerente, motivo);
- o estado da credencial na linha de base;
- os eventos `credencial_pin_*` posteriores à exceção, marcados **"registro não
  comprovado"**.

As **5 assinaturas `pin_esquecido`** entram assim. O admin decide cada uma: encerra com
motivo (§6) se o PIN já funciona, ou redefine. **Nada é encerrado nem aberto como reset
automaticamente.**

---

## 11. O SQL das tabelas — para confirmação antes de criar

**Cada tabela vem com a sua proteção no mesmo bloco.**

```sql
-- FATOS DA CREDENCIAL DO MOTOBOY — escritos só por gatilho em motoboy_credenciais.
create table public.credencial_fatos (
  id             bigint generated always as identity primary key,
  tenant_id      uuid not null references public.tenants(id),
  credencial_id  uuid not null references public.motoboy_credenciais(id),
  motoboy_id     uuid not null references public.mototaxistas(id),
  fato           text not null check (fato in (
                   'inicio_com_pin', 'inicio_sem_pin',
                   'cartao_emitido', 'cartao_revogado',
                   'pin_cadastrado', 'pin_zerado')),
  -- `auth.uid()` de quem chamou a função que mudou a credencial. Nulo quando não
  -- houver sessão (a linha de base, gravada pela migration).
  por            uuid references public.profiles(id),
  em             timestamptz not null default now()
);
create index on public.credencial_fatos (tenant_id, motoboy_id, em);

alter table public.credencial_fatos enable row level security;
revoke all on public.credencial_fatos from anon, authenticated;


-- ENCERRAMENTO MANUAL — uma linha por autorização excepcional encerrada.
create table public.pedido_credencial_encerramentos (
  autorizacao_id  uuid primary key references public.motoboy_autorizacoes(id),
  tenant_id       uuid not null references public.tenants(id),
  encerrado_por   uuid not null references public.profiles(id),
  encerrado_em    timestamptz not null default now(),
  motivo          text not null check (length(btrim(motivo)) > 0)
);

alter table public.pedido_credencial_encerramentos enable row level security;
revoke all on public.pedido_credencial_encerramentos from anon, authenticated;
```

Na migration vêm também: a remoção guardada das tabelas do §1; o gatilho de fatos com a
linha de base; `pedidos_de_credencial()` e `encerrar_pedido_de_credencial(...)`, com
grant de execução para `authenticated` e o cargo conferido dentro; e as conferências no
rodapé.

---

## 12. Endurecimento achado pela revisão — não é pré-requisito, mas não pode ficar esquecido

A versão 2 não lê `eventos` nem `assinaturas`, mas a revisão expôs duas portas que valem
para o sistema inteiro:

- **`eventos_insert` aceita qualquer `tipo`.** Um cliente consegue gravar
  `romaneio_selado`, `conflito_retorno` ou `credencial_pin_redefinido`, que o Registro de
  Auditoria mostra como se o servidor os tivesse produzido. O cliente legítimo grava só
  `pagamento_alterado`, `falta_receita`, `falta_documento_convenio` e
  `entrega_cancelada`. Proposta: gatilho `before insert` que recusa os tipos do servidor
  quando `current_user` for `authenticated`;
- **`assinaturas_insert` é sobra** do fluxo anterior ao romaneio: nenhum código do cliente
  grava assinatura desde 16/08. Proposta: remover a policy.

Migration própria, com decisão sua sobre fazer agora ou no corte.

---

## 13. Aceite

| cenário | esperado |
|---|---|
| exceção online por PIN esquecido | `aguardando_admin`, com operação, filial e gerente |
| **duas sincronizações simultâneas** do mesmo motoboy | as duas operações seladas; um pedido só, com as duas |
| **reenvio** da mesma operação | nada muda |
| **evento indevido**: inserir à mão `credencial_pin_definido` | o pedido continua como estava |
| **assinatura indevida**: inserir à mão uma assinatura `pin_esquecido` | não aparece pedido |
| **reset antes da sincronização** (8h offline, 10h cadastro, 11h sincroniza) | `verificar`, nunca pedido novo nem encerrado |
| **relógio errado**: balcão 40 min e 2 dias fora | nenhum encerramento; no máximo `verificar` |
| **novo esquecimento** online depois de atendido | pedido novo `aguardando_admin` |
| **zerado sem cadastro** | `pin_zerado`, não `atendido` |
| **troca de cartão** (emitir novo e cadastrar PIN) | PIN esquecido `atendido`; cartão perdido `cartao_emitido` → `atendido` |
| cartão do gerente com PIN cadastrado | não resolve pedido de motoboy |
| **encerramento pelo admin** | `encerrado` com motivo; PIN e cartão intactos; clicar duas vezes não duplica |
| **outra sessão** | o pedido aparece ao voltar o foco ou em até 60 s |
| **cargos** | admin vê o tenant; gerente só a filial; caixa não vê o painel |
| **as 5 exceções existentes** | todas `verificar`, com evidência e o indício marcado como não comprovado |
| verificador de romaneios | inalterado — nada disto entra em hash |
