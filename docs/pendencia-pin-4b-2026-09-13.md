# Pedidos de credencial — PIN esquecido e cartão perdido

13/09/2026, **versão 3, proposta, nada aplicado por esta sessão.** Fecha o §5 do
[desenho do 4B](desenho-4b-2026-09-11.md): *quando o gerente autoriza no lugar do
motoboy, o admin precisa ter onde acompanhar a providência.*

**Ordem combinada:** corrigir este documento → fechar as regras de estado (§4) →
preparar as migrations completas → implementar e testar. Nada de migration antes de o
§4 estar confirmado.

## O que mudou em cada versão

**v1 → v2** (primeira revisão do usuário): fatos só de tabelas sem escrita do cliente;
nenhum gatilho no selo, pedido derivado na leitura; vínculo com a credencial;
encerramento manual; cargos explícitos; "o admin foi avisado" retirado.

**v2 → v3** (segunda revisão, com conferência no banco):

| # | v2 | a revisão | v3 |
|---|---|---|---|
| 1 | §1 afirmava que as tabelas criadas fora de migration estavam **abertas ao público** | **errado**: elas têm RLS ligada e nenhuma policy — negação por padrão. Faltava estrutura, não havia exposição comprovada. Também não há evidência de quem as criou | §1 corrigido; remoção **dentro da migration**, com verificação de conteúdo e dependências, e nenhum `drop` avulso |
| 2 | janela de 24 h no relógio do balcão para decidir ambiguidade | reproduzido: operação offline às 8h de 13/09, balcão **dois dias adiantado**, PIN novo às 10h, sincronização às 11h → a fórmula não acha resolução nem ambiguidade e cai em "Aguardando admin". Alargar a janela só desloca o problema | **o relógio do balcão não entra em nenhuma regra**. O limite inferior de uma operação offline só vem de um fato do servidor (§4) |
| 3 | só a ativação do PIN contava como providência | falta reconhecer PIN **já zerado**, cartão **já emitido** e caso **já encerrado** antes de a operação chegar | toda providência entra na regra, com precedência explícita, e nenhuma operação atrasada sugere repetir o que já está em curso (§4) |
| 4 | gatilho de fatos com `motoboy_id not null` | a mesma tabela guarda o cartão do **gerente**, e `redefinir_meu_pin()` a altera — sem guarda, o gatilho quebraria o gerente redefinindo o próprio PIN | o gatilho **ignora explicitamente** credencial de gerente (§2) |
| 5 | gerente via o pedido com operação na filial dele | um motoboy roda em várias filiais: o pedido inteiro revelaria operações de outras | a função devolve ao gerente **só as operações, detalhes e ids da filial dele** (§7) |
| 6 | atualização a cada 60 s | é entrega intermediária, não o encaminhamento em tempo real; e o contador precisa andar fora da página de Credenciais | declarado como intermediário; contador no cabeçalho, em qualquer tela; tempo real continua pendente (§8) |

**Decisões do usuário nesta revisão:**
- a janela de 24 h **não é aprovada** como regra decisória — saiu;
- a proteção de `eventos` e `assinaturas` **é feita agora**, em migration separada
  (§12).

**Confirmado no banco pelo usuário:** as duas tabelas da v1 continuam vazias, e as 5
assinaturas `pin_esquecido` correspondem a **5 autorizações excepcionais consumidas por
romaneios selados**, com motoboy, tenant e hash correspondentes — ou seja, são
recuperáveis pela origem que este documento usa.

---

## 1. O que existe no banco hoje

- **As duas tabelas da versão 1** (`pendencias_credencial` e
  `pendencia_credencial_operacoes`) existem, **vazias**, sem arquivo em
  `supabase/migrations/`. **Não há evidência de quem as criou.**
- **Elas têm RLS ligada e nenhuma policy.** No PostgreSQL isso é negação por padrão:
  mesmo com as permissões de tabela que o Supabase concede a `anon` e `authenticated`,
  nenhuma linha é lida nem escrita por esses papéis. **A estrutura está incompleta; não
  há exposição pública.** A versão 2 deste documento afirmou o contrário, confundindo
  ausência de policy com ausência de RLS — erro meu.
- Nenhuma função, policy ou publicação de tempo real as referencia.

**A versão 3 não usa essas tabelas.** A remoção vai **dentro da migration**, que antes
de apagar confere, e recusa com mensagem se falhar:

```
contagem de linhas das duas = 0
nenhuma dependência além das próprias FKs entre elas
  (views, funções, policies, FKs vindas de outras tabelas — pg_depend)
```

Nenhum `drop table` avulso deve ser executado antes disso.

---

## 2. A origem dos fatos — só o que o cliente não escreve

Conferido nas migrations:

| Fato | Onde | Por que é confiável |
|---|---|---|
| **o gerente autorizou por um motivo** | `motoboy_autorizacoes` com `validador_profile_id` e `motivo_excecao` | RLS ligada, `revoke all`, nenhum grant: só funções `SECURITY DEFINER` gravam. `motoboy_id` é o **motoboy da operação**; `credencial_id` é o cartão do gerente |
| **a operação aconteceu** | autorização com `consumida_por_romaneio` apontando para `romaneios` com `status = 'selado'` | `romaneios` só tem `grant select` |
| **PIN zerado, PIN cadastrado, cartão emitido, cartão revogado** | tabela nova `credencial_fatos`, preenchida por gatilho em `motoboy_credenciais` | sem grant de escrita para o cliente. `pin_hash` só muda em `definir_pin`, `redefinir_pin` e `redefinir_meu_pin`; a autenticação não reescreve o hash; emitir cartão insere e revoga o anterior |

**Nem `eventos` nem `assinaturas` entram na decisão.** Os eventos `credencial_pin_*`
aparecem só como **indício não comprovado** nos casos anteriores ao acompanhamento
(§10).

### O gatilho de fatos ignora o cartão do gerente — explicitamente

`motoboy_credenciais` guarda **dois titulares**: `motoboy_id` ou `profile_id`, com CHECK
de exatamente um. `redefinir_meu_pin()` altera o cartão do gerente na mesma tabela.
Então:

```
after insert or update on motoboy_credenciais
  for each row
  when (new.motoboy_id is not null
        and (tg_op = 'INSERT'
             or old.pin_hash is distinct from new.pin_hash
             or old.ativo    is distinct from new.ativo))
```

- **Credencial de gerente não gera fato nem chama a função.** A cláusula `when` barra
  antes, e a função repete a guarda por defesa.
- **Sem essa guarda**, o `insert` do fato com `motoboy_id` nulo violaria o `not null` e
  **desfaria a redefinição do PIN do próprio gerente** — a exceção que existe para
  destravar o balcão travaria o gerente.
- A autenticação atualiza `tentativas_pin` na mesma linha durante a sincronização; com
  `pin_hash` e `ativo` inalterados, a condição é falsa e a função não roda. **O gatilho
  não fica no caminho do selo.**

---

## 3. Nenhum gatilho no selo: o pedido é DERIVADO

Não existe linha de "pedido" criada no selo. `pedidos_de_credencial()`,
`SECURITY DEFINER`, calcula os pedidos na leitura a partir dos fatos do §2.

- concorrência no selo deixa de existir — duas sincronizações simultâneas gravam duas
  autorizações, como hoje;
- nenhuma falha de acompanhamento desfaz saída ou retorno;
- reenvio não duplica: a autorização é consumida uma vez;
- **retroativo sem backfill**: as 5 exceções existentes aparecem (§10);
- a regra fica num lugar só, e muda sem migrar dado.

As únicas escritas novas: os fatos da credencial (§2) e o encerramento manual (§6).

---

## 4. As regras de estado — PARA CONFIRMAR

### 4.1 O princípio

> **Só o relógio do servidor decide.** O relógio do balcão não entra em nenhuma regra —
> nem para resolver, nem para descartar uma ambiguidade. **Havendo dúvida, "Verificar".**

O relógio do balcão (`ocorrido_em_local`) continua aparecendo na tela como informação.

### 4.2 Os termos

**Exceção `e`** — uma autorização com `motivo_excecao`, consumida por romaneio selado.
Tem motoboy `m`, tipo (`pin_esquecido` ou `cartao_perdido`) e modo (`online` ou
`offline_sincronizada`).

**Limite superior `S(e)`** — o instante do servidor antes do qual a exceção certamente
aconteceu:

| modo | `S(e)` |
|---|---|
| online | `motoboy_autorizacoes.criada_em` — o instante da validação do PIN do gerente |
| offline | `romaneios.recebido_em_servidor` — a sincronização |

**Limite inferior `I(e)`** — o instante do servidor depois do qual ela certamente
aconteceu, ou a partir do qual o que veio antes não importa:

| modo | `I(e)` |
|---|---|
| online | `criada_em` (igual a `S(e)`) |
| offline | a **exceção ONLINE mais recente** do mesmo motoboy e tipo com `criada_em ≤ S(e)`; sem nenhuma, o **início do acompanhamento** (§10) |

**Por que uma exceção online serve de limite inferior para uma offline:** ela prova, no
relógio do servidor, que o problema existia no instante `t0`. Uma providência anterior a
`t0` não resolveu a situação de `t0`. Se a offline aconteceu depois de `t0`, a
providência veio antes dela; se aconteceu antes, ela faz parte da mesma situação ainda
aberta em `t0`. Nos dois casos, **só providência posterior a `t0` pode ter resolvido
`e`** — sem nenhuma hora do balcão.

**Providências**, por tipo:

| tipo | em curso (parcial) | conclusão |
|---|---|---|
| `pin_esquecido` | `pin_zerado` numa credencial do motoboy; `cartao_emitido` para o motoboy | `pin_cadastrado` numa credencial do motoboy |
| `cartao_perdido` | `cartao_emitido` para o motoboy | `pin_cadastrado` num cartão emitido **depois** de `I(e)` |
| os dois | — | encerramento manual daquela exceção (§6) |

**Providência em curso agora:** a providência parcial mais recente do motoboy não tem
conclusão posterior a ela.

### 4.3 A classificação de cada exceção — primeira regra que valer

| ordem | classe | quando |
|---|---|---|
| 1 | **encerrada** | há encerramento manual desta exceção |
| 2 | **anterior ao acompanhamento** | `S(e)` < início do acompanhamento |
| 3 | **resolvida** | há conclusão com `em > S(e)` |
| 4 | **em andamento** | há providência em curso agora (a parcial sem conclusão depois dela) |
| 5 | **ambígua** | offline, e há **qualquer** providência — parcial, conclusão ou encerramento de outra exceção do mesmo motoboy e tipo — com `I(e) < em ≤ S(e)` |
| 6 | **aberta** | nenhuma das anteriores |

**Por que "em andamento" vem antes de "ambígua" e "aberta":** com o PIN zerado e ainda
não cadastrado, o motoboy **não tem** PIN — toda autorização pelo gerente enquanto isso é
esperada, e já está coberta pela providência em curso. **Nada ali sugere outro reset**,
nem para a exceção que sincronizou atrasada, nem para a online que veio depois do reset.

### 4.4 O pedido que o painel mostra

Por motoboy e tipo, **um pedido aberto** reúne as exceções das classes 2, 4, 5 e 6.
Estado do pedido:

| precedência | estado | quando | ação oferecida |
|---|---|---|---|
| 1 | **Aguardando o admin** | alguma exceção **aberta** | "Redefinir PIN" ou "Emitir cartão"; "Encerrar com motivo". As ambíguas do mesmo pedido aparecem marcadas "pode já estar coberta por …" |
| 2 | **PIN zerado — falta o motoboy cadastrar** / **Cartão emitido — falta cadastrar o PIN** | exceções em andamento | só "Encerrar com motivo". **Nenhum botão de reset** |
| 3 | **Verificar se o problema persiste** | só ambíguas ou anteriores | mostra cada providência encontrada, com data do servidor, e as duas ações: "Encerrar — o problema já foi resolvido" (motivo) ou "O problema persiste: redefinir PIN" |

"Aberta" e "em andamento" não coexistem: havendo providência em curso, a classe 4 pega
antes. Exceções **resolvidas** e **encerradas** formam o histórico, agrupadas pela
conclusão ou pelo encerramento que as fechou.

### 4.5 Os casos da revisão, pela regra

| caso | classificação | estado |
|---|---|---|
| offline às 8h, **balcão +2 dias**, PIN novo às 10h, sincroniza às 11h, sem exceção online antes | `I` = início; `S` = 11h; cadastro às 10h está em `(I, S]` → **ambígua** | **Verificar** |
| mesmo caso, com exceção online às 7h | `I` = 7h; cadastro às 10h em `(7h, 11h]` → **ambígua** | **Verificar** |
| admin **zerou** às 10h, motoboy não cadastrou, operação offline das 8h chega às 11h | há providência em curso → **em andamento** | **PIN zerado — falta cadastrar** |
| admin **emitiu cartão** às 10h, sem PIN, cartão perdido offline chega às 11h | em curso → **em andamento** | **Cartão emitido — falta o PIN** |
| admin **encerrou** às 10h a exceção das 7h; offline das 8h chega às 11h | encerramento em `(I, S]` → **ambígua** | **Verificar**, mostrando o encerramento |
| exceção **online** às 15h, depois de PIN cadastrado às 10h | conclusão antes de `S` = 15h; nada em curso; online não é ambígua → **aberta** | **Aguardando o admin** |
| exceção online às 15h com o PIN **zerado** às 12h e não cadastrado | em curso → **em andamento** | **PIN zerado — falta cadastrar** |
| exceção às 9h, PIN cadastrado às 10h | conclusão depois de `S` → **resolvida** | histórico |

---

## 5. Cartão perdido — pedido próprio, sem revogação automática

Confirmado pelo usuário: mesmo mecanismo do §4, tipo próprio. **Nada revoga o cartão
automaticamente** ao registrar a exceção; emitir o cartão novo já revoga o anterior, e
esse é o ato do admin.

**Cartão novo com PIN cadastrado conclui também o PIN esquecido** — o motoboy voltou a
ter credencial com PIN. O cartão do gerente nunca conclui pedido de motoboy.

---

## 6. O encerramento pelo admin

- RPC `encerrar_pedido_de_credencial(p_autorizacao_ids uuid[], p_motivo text)`;
- **só admin**, do tenant; motivo obrigatório;
- uma linha por autorização (chave primária = a autorização); repetir não duplica;
- **não toca na credencial**: não zera PIN, não revoga cartão;
- encerra só as exceções listadas, e **conta como providência** para a ambiguidade do
  §4: uma operação que chegue depois vai para Verificar, mostrando o encerramento.

---

## 7. Quem vê

| cargo | vê |
|---|---|
| admin | todos os pedidos do tenant, com todas as operações |
| gerente | os pedidos com alguma operação **na filial dele**, e **dentro deles só as operações, os detalhes e os identificadores da filial dele** |
| caixa | nenhum — o painel não é dele |

**Para o gerente, o estado do pedido é calculado sobre a credencial inteira** (é a
verdade da credencial), mas a função **não devolve** operação, romaneio, filial, gerente
validador nem contagem de outra filial. A tela dele diz "há registros deste motoboy em
outras filiais" só se isso for decidido depois; por padrão, não diz.

As tabelas novas ficam com RLS ligada, `revoke all` e **sem policy de leitura direta**:
nada chega a elas fora das duas funções.

---

## 8. O aviso — entrega intermediária, declarada como tal

| onde | texto |
|---|---|
| fim da saída ou do retorno com o gerente, **online** | "Pedido registrado no painel do administrador." |
| idem, **offline** | "O pedido será registrado no painel do administrador quando este registro sincronizar." |
| painel (Cadastros › Credenciais) | a lista, com estado, evidência e ações do §4.4 |
| **cabeçalho, em qualquer tela** | contagem de pedidos em "Aguardando o admin" e "Verificar" — para o admin, do tenant; para o gerente, os da filial |

- o contador vive no **cabeçalho** (`AppLayout`), não na página de Credenciais: atualiza
  a cada **60 segundos** e ao voltar o foco à janela, em qualquer tela;
- depois de reconectar, a primeira consulta traz tudo, porque o pedido é derivado de
  fatos no banco;
- o pedido continua aparecendo nos dias seguintes até ser concluído ou encerrado;
- abrir ou ler não encerra nada.

**Isto não é o encaminhamento em tempo real.** É uma primeira entrega para o
acompanhamento de credenciais. **O fluxo em tempo real continua pendente**, e para as
**divergências entre caixa, gestor e admin** ele é necessário e não é substituído por
este contador.

---

## 9. O que o pedido NÃO faz

- **não retém vale** cuja operação foi validamente autorizada pelo gerente;
- **não muda a atribuição**: o vale continua no motoboy da operação;
- **não desfaz nem marca o selo**, e não entra em hash nenhum;
- **não bloqueia o motoboy** nem o cartão.

---

## 10. O início do acompanhamento e os casos anteriores

A migration grava, ao ser aplicada, uma **linha de base** em `credencial_fatos` para cada
credencial ativa de motoboy (`inicio_com_pin` ou `inicio_sem_pin`). O **início do
acompanhamento** é o instante dessa linha.

**A linha de base não é providência.** `inicio_com_pin` só diz que havia um hash — um PIN
esquecido continua gravado. Ela não conclui nada.

Toda exceção com `S(e)` anterior ao início cai em **"Verificar"** (classe 2), com a
evidência da operação, o estado da credencial na linha de base e os eventos
`credencial_pin_*` posteriores marcados **"registro não comprovado"**. **As 5 exceções
existentes** — conferidas pelo usuário como autorizações consumidas por romaneios
selados — entram assim. O admin decide cada uma: encerra com motivo ou redefine.

---

## 11. O SQL das tabelas — para confirmação antes de criar

**Cada tabela vem com a sua proteção no mesmo bloco.**

```sql
-- FATOS DA CREDENCIAL DO MOTOBOY — escritos só pelo gatilho em motoboy_credenciais,
-- que ignora credencial de gerente (§2).
create table public.credencial_fatos (
  id             bigint generated always as identity primary key,
  tenant_id      uuid not null references public.tenants(id),
  credencial_id  uuid not null references public.motoboy_credenciais(id),
  motoboy_id     uuid not null references public.mototaxistas(id),
  fato           text not null check (fato in (
                   'inicio_com_pin', 'inicio_sem_pin',
                   'cartao_emitido', 'cartao_revogado',
                   'pin_cadastrado', 'pin_zerado')),
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

A migration também traz: a remoção guardada das tabelas do §1; o gatilho de fatos com a
guarda do gerente e a linha de base; `pedidos_de_credencial()` e
`encerrar_pedido_de_credencial(...)`, com o cargo e a filial conferidos dentro; e as
conferências no rodapé.

---

## 12. Proteção de `eventos` e `assinaturas` — migration separada, feita agora

Decidido pelo usuário: não espera pelos pedidos, porque as permissões afetam a
confiança da auditoria inteira.

### O que foi medido nas migrations e no código

| Quem grava em `eventos` | Tipos | Como |
|---|---|---|
| `fn_log_entrega` (gatilho `trg_entregas_log`) | `entrega_criada`, `status_alterado` | `SECURITY DEFINER` |
| `log_credencial` | `credencial_*` | `SECURITY DEFINER` |
| `selar_romaneio_interno` | `romaneio_selado` | `SECURITY DEFINER` |
| `selar_romaneio_retorno_interno` | `romaneio_retorno_selado`, `insucesso_detalhado`, `documento_faltante`, `pagamento_alterado` | `SECURITY DEFINER` |
| `registrar_conflito_romaneio` / `_retorno` | `conflito_sincronizacao`, `conflito_retorno` | `SECURITY DEFINER` |
| **cliente** (`inserirEventoIdempotente`) | **só** `pagamento_alterado`, `falta_receita`, `falta_documento_convenio`, `entrega_cancelada` | policy `eventos_insert` |
| Edge Functions | nenhum | — |

- **Todo escritor do servidor é `SECURITY DEFINER`**, e roda como dono da tabela — a RLS
  não se aplica a ele. Nenhuma migration usa `force row level security`.
- **`assinaturas` não tem escritor no cliente** desde 16/08: só leituras em
  `data/romaneios.ts`. Todas as gravações são das funções de selo.

### O que a migration faz

```
eventos_insert       with check (tenant_id = current_tenant_id()
                                 and tipo in ('pagamento_alterado', 'falta_receita',
                                              'falta_documento_convenio',
                                              'entrega_cancelada'))
assinaturas_insert   removida; revoke insert de anon e authenticated
```

**Conferências no rodapé:** as funções do servidor continuam gravando (um selo e um
cancelamento de teste); o cliente grava os quatro tipos; o cliente **não** grava
`romaneio_selado`, `credencial_pin_definido` nem assinatura; o verificador de romaneios
inalterado.

**O que ela NÃO resolve, e fica escrito:** `pagamento_alterado` é tipo **legítimo** do
cliente (a divergência marcada depois do retorno), então o cliente continua podendo
gravar um com payload inventado — por exemplo, alegando `origem: romaneio_retorno`.
Proposta para a mesma migration: recusar do cliente `pagamento_alterado` com
`romaneio_retorno_id` no payload, que só o selo produz. **Decisão sua.**

---

## 13. Aceite

| cenário | esperado |
|---|---|
| exceção online por PIN esquecido | **Aguardando o admin**, com operação, filial e gerente |
| duas sincronizações simultâneas do mesmo motoboy | as duas operações seladas; um pedido só |
| reenvio da mesma operação | nada muda |
| evento indevido: inserir `credencial_pin_definido` à mão | **recusado** pela §12; e, antes dela, o pedido não mudaria |
| assinatura indevida: inserir à mão | **recusada** pela §12; e não geraria pedido |
| **balcão dois dias adiantado** (8h real, PIN às 10h, sincroniza às 11h) | **Verificar** |
| mesmo caso com exceção online antes | **Verificar** |
| **PIN zerado antes da sincronização**, sem cadastro | **PIN zerado — falta cadastrar**; sem botão de reset |
| **cartão emitido antes da sincronização**, sem PIN | **Cartão emitido — falta o PIN** |
| **encerrado antes da sincronização** | **Verificar**, mostrando o encerramento |
| novo esquecimento online depois de concluído | pedido novo, **Aguardando o admin** |
| exceção online com o PIN zerado e não cadastrado | **PIN zerado — falta cadastrar** |
| troca de cartão (emitir e cadastrar PIN) | cartão perdido e PIN esquecido **concluídos** |
| cartão do gerente com PIN cadastrado | não conclui pedido de motoboy |
| **gerente redefine o próprio PIN** | funciona; nenhum fato gravado |
| encerramento pelo admin | **encerrado** com motivo; PIN e cartão intactos; clicar duas vezes não duplica |
| **outra sessão**, fora da página de Credenciais | o contador do cabeçalho muda ao voltar o foco ou em até 60 s |
| **gerente de uma filial**, motoboy com operações em duas | vê o pedido e **só as operações da filial dele** |
| caixa | não vê o painel nem o contador |
| as 5 exceções existentes | todas **Verificar**, com evidência e o indício marcado como não comprovado |
| migration com as tabelas da v1 contendo uma linha | a migration **recusa** a remoção, com mensagem |
| verificador de romaneios | inalterado |
