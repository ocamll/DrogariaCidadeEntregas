# Pedidos de credencial — PIN esquecido e cartão perdido

13/09/2026, **versão 3.1, proposta, nada aplicado por esta sessão.** Fecha o §5 do
[desenho do 4B](desenho-4b-2026-09-11.md): *quando o gerente autoriza no lugar do
motoboy, o admin precisa ter onde acompanhar a providência.*

**Ordem combinada:** corrigir este documento → fechar as regras de estado (§4) →
preparar as migrations completas → implementar e testar. **A proteção de `eventos` e
`assinaturas` (§12) vem primeiro e já está preparada**; a migration dos pedidos espera o
§4.

## O que mudou em cada versão

**v1 → v2** (primeira revisão do usuário): fatos só de tabelas sem escrita do cliente;
nenhum gatilho no selo, pedido derivado na leitura; vínculo com a credencial;
encerramento manual; cargos explícitos; "o admin foi avisado" retirado.

**v2 → v3** (segunda revisão, com conferência no banco): §1 corrigido (as tabelas da v1
têm RLS ligada e nenhuma policy — negação por padrão, não exposição); janela de 24 h no
relógio do balcão retirada; providências já iniciadas reconhecidas; gatilho de fatos
ignorando o cartão do gerente; gerente vendo só as operações da própria filial; 60 s
declarado como intermediário.

**v3 → v3.1** (terceira revisão). **Os três estados do painel foram confirmados**; a
classificação do §4 não, por três casos:

| caso | o que a v3 faria | o que deve acontecer | v3.1 |
|---|---|---|---|
| exceção anterior ao acompanhamento; depois o admin redefine e o motoboy cadastra | "anterior" vinha antes de "resolvida": continuava em Verificar | vai para o histórico como resolvida, ligada ao fato novo | **"resolvida" vem antes de "anterior"** |
| a credencial já está sem PIN quando o acompanhamento começa; ocorre uma exceção depois | a linha de base não conta como providência → podia oferecer "Redefinir PIN" | "Aguardando cadastro do PIN": zerar o que já está zerado não ajuda | **o estado ATUAL da credencial entra na regra** |
| cartão emitido às 10h; o motoboy perde esse cartão antes de cadastrar o PIN; nova exceção online às 11h | a emissão "em curso" escondia a ação de emitir outro | reconhecer a perda nova e permitir providência | **PIN esquecido e cartão perdido têm regras separadas**: uma emissão anterior não prova que o motoboy ainda tem aquele cartão |

E a ação de **"Verificar"** passa a depender do tipo: cartão perdido oferece "O problema
persiste: emitir cartão", não "redefinir PIN".

**Decisões do usuário, acumuladas:**
- os três estados do painel estão confirmados;
- a janela de 24 h não é regra decisória;
- a proteção de `eventos` e `assinaturas` é feita **agora**, com o bloqueio de
  `romaneio_retorno_id` **e** de `origem` vindos do cliente (§12).

**Confirmado no banco pelo usuário:** as duas tabelas da v1 continuam vazias, e as 5
assinaturas `pin_esquecido` correspondem a 5 autorizações excepcionais consumidas por
romaneios selados, com motoboy, tenant e hash correspondentes.

---

## 1. O que existe no banco hoje

- **As duas tabelas da versão 1** (`pendencias_credencial` e
  `pendencia_credencial_operacoes`) existem, **vazias**, sem arquivo em
  `supabase/migrations/`. **Não há evidência de quem as criou.**
- **Elas têm RLS ligada e nenhuma policy** — negação por padrão. **A estrutura está
  incompleta; não há exposição pública.** A versão 2 deste documento afirmou o
  contrário, confundindo ausência de policy com ausência de RLS — erro meu.
- Nenhuma função, policy ou publicação de tempo real as referencia.

**A versão 3.1 não usa essas tabelas.** A remoção vai **dentro da migration dos
pedidos**, que antes de apagar confere, e recusa com mensagem se falhar:

```
contagem de linhas das duas = 0
nenhuma dependência além das próprias FKs entre elas
  (views, funções, policies, FKs vindas de outras tabelas — pg_depend)
```

Nenhum `drop table` avulso deve ser executado antes disso.

---

## 2. A origem dos fatos — só o que o cliente não escreve

| Fato | Onde | Por que é confiável |
|---|---|---|
| **o gerente autorizou por um motivo** | `motoboy_autorizacoes` com `validador_profile_id` e `motivo_excecao` | RLS ligada, `revoke all`, nenhum grant: só funções `SECURITY DEFINER` gravam. `motoboy_id` é o **motoboy da operação**; `credencial_id` é o cartão do gerente |
| **a operação aconteceu** | autorização com `consumida_por_romaneio` apontando para `romaneios` com `status = 'selado'` | `romaneios` só tem `grant select` |
| **PIN zerado, PIN cadastrado, cartão emitido, cartão revogado** | tabela nova `credencial_fatos`, preenchida por gatilho em `motoboy_credenciais` | sem grant de escrita para o cliente. `pin_hash` só muda em `definir_pin`, `redefinir_pin` e `redefinir_meu_pin`; emitir cartão insere e revoga o anterior |
| **o estado ATUAL da credencial do motoboy** | a própria `motoboy_credenciais`: cartão ativo, e `pin_hash is null` | a função de leitura é `SECURITY DEFINER` e devolve **só o booleano** "tem PIN" — nunca o hash |

**Nem `eventos` nem `assinaturas` entram na decisão.** Os eventos `credencial_pin_*`
aparecem só como **indício não comprovado** nos casos anteriores ao acompanhamento
(§10).

### O gatilho de fatos ignora o cartão do gerente — explicitamente

`motoboy_credenciais` guarda **dois titulares** (`motoboy_id` ou `profile_id`, CHECK de
exatamente um), e `redefinir_meu_pin()` altera o cartão do gerente na mesma tabela:

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
- **Sem essa guarda**, o fato com `motoboy_id` nulo violaria o `not null` e **desfaria a
  redefinição do PIN do próprio gerente**.
- A autenticação atualiza `tentativas_pin` na mesma linha durante a sincronização; com
  `pin_hash` e `ativo` inalterados, a condição é falsa e a função não roda. **O gatilho
  não fica no caminho do selo.**

---

## 3. Nenhum gatilho no selo: o pedido é DERIVADO

Não existe linha de "pedido" criada no selo. `pedidos_de_credencial()`,
`SECURITY DEFINER`, calcula os pedidos na leitura a partir dos fatos do §2.

- concorrência no selo deixa de existir;
- nenhuma falha de acompanhamento desfaz saída ou retorno;
- reenvio não duplica: a autorização é consumida uma vez;
- **retroativo sem backfill**: as 5 exceções existentes aparecem (§10);
- a regra fica num lugar só, e muda sem migrar dado.

As únicas escritas novas: os fatos da credencial (§2) e o encerramento manual (§6).

---

## 4. As regras de estado — PARA CONFIRMAR

### 4.1 Os princípios

> **Só o servidor decide.** O relógio do balcão não entra em nenhuma regra. Havendo
> dúvida, **"Verificar"**.
>
> 1. **Uma conclusão posterior e confiável resolve também uma exceção antiga.**
> 2. **O estado atual da credencial impede providências inúteis** — zerar o que já está
>    zerado, por exemplo.
> 3. **Uma providência anterior não esconde um problema novo.**
> 4. **Sem informação suficiente, "Verificar".**

O relógio do balcão (`ocorrido_em_local`) continua aparecendo na tela como informação.

### 4.2 Os termos

**Exceção `e`** — uma autorização com `motivo_excecao`, consumida por romaneio selado.
Tem motoboy `m`, tipo (`pin_esquecido` ou `cartao_perdido`) e modo.

**Limite superior `S(e)`** — o instante do servidor antes do qual ela certamente
aconteceu:

| modo | `S(e)` |
|---|---|
| online | `motoboy_autorizacoes.criada_em` |
| offline | `romaneios.recebido_em_servidor` |

**Limite inferior `I(e)`** — o instante do servidor a partir do qual o que veio antes não
importa:

| modo | `I(e)` |
|---|---|
| online | `criada_em` (igual a `S(e)`) |
| offline | a **exceção ONLINE mais recente** do mesmo motoboy e tipo com `criada_em ≤ S(e)`; sem nenhuma, o **início do acompanhamento** (§10) |

Uma exceção online prova, no relógio do servidor, que o problema existia em `t0`: só
providência posterior a `t0` pode ter resolvido uma exceção offline — tenha ela
acontecido antes ou depois de `t0`.

**Estado atual da credencial do motoboy** (lido no instante da consulta):

| estado | quando |
|---|---|
| `com_pin` | tem cartão ativo com PIN |
| `sem_pin` | tem cartão ativo **sem** PIN |
| `sem_cartao` | não tem cartão ativo |

### 4.3 A classificação de cada exceção — primeira regra que valer

#### PIN esquecido

| ordem | classe | quando |
|---|---|---|
| 1 | **encerrada** | há encerramento manual desta exceção |
| 2 | **resolvida** | `pin_cadastrado` numa credencial do motoboy com `em > S(e)` — **vale também para exceção anterior ao acompanhamento** |
| 3 | **aguardando cadastro** | a credencial está `sem_pin` agora |
| 4 | **anterior ao acompanhamento** | `S(e)` < início do acompanhamento |
| 5 | **ambígua** | offline, e há `pin_zerado`, `pin_cadastrado`, `cartao_emitido` ou encerramento de outra exceção de PIN do motoboy com `I(e) < em ≤ S(e)` |
| 6 | **aberta** | nenhuma das anteriores |

**Por que "aguardando cadastro" vem logo depois de "resolvida":** com o cartão ativo sem
PIN, **a única providência útil é o motoboy cadastrar**. Zerar de novo não muda nada, e
novas autorizações pelo gerente enquanto isso são esperadas. Isso vale mesmo que a
credencial já estivesse sem PIN quando o acompanhamento começou.

#### Cartão perdido

| ordem | classe | quando |
|---|---|---|
| 1 | **encerrada** | há encerramento manual desta exceção |
| 2 | **resolvida** | há cartão emitido para o motoboy com emissão **`em > S(e)`**, e PIN cadastrado nele |
| 3 | **aguardando cadastro** | há cartão emitido com emissão **`em > S(e)`**, ainda ativo e sem PIN |
| 4 | **anterior ao acompanhamento** | `S(e)` < início do acompanhamento |
| 5 | **ambígua** | offline, e há `cartao_emitido`, `pin_cadastrado` num cartão emitido ou encerramento de outra exceção de cartão do motoboy com `I(e) < em ≤ S(e)` |
| 6 | **aberta** | nenhuma das anteriores |

**Por que só a emissão POSTERIOR à exceção conta:** uma emissão anterior não prova que o
motoboy ainda tem aquele cartão. Se ele perdeu o cartão novo antes de cadastrar o PIN, a
exceção seguinte é uma **perda nova**, e precisa poder levar a outra emissão. É aqui que
PIN esquecido e cartão perdido se separam: para o PIN, cartão ativo sem PIN basta para
aguardar cadastro; para o cartão, não.

### 4.4 O pedido que o painel mostra — os três estados confirmados

Por motoboy e tipo, **um pedido aberto** reúne as exceções das classes 3 a 6. Estado:

| precedência | estado | quando |
|---|---|---|
| 1 | **Aguardando o admin** | alguma exceção **aberta** |
| 2 | **Aguardando cadastro do PIN** — "PIN zerado — falta o motoboy cadastrar" ou "Cartão emitido — falta cadastrar o PIN" | alguma **aguardando cadastro**, nenhuma aberta |
| 3 | **Verificar se o problema persiste** | só **ambíguas** ou **anteriores** |

As exceções ambíguas dentro de um pedido em estado 1 ou 2 aparecem marcadas "pode já
estar coberta por …". **Resolvidas** e **encerradas** formam o histórico, agrupadas pela
conclusão ou pelo encerramento que as fechou.

**As ações**, por estado, tipo e credencial:

| estado | PIN esquecido | cartão perdido |
|---|---|---|
| Aguardando o admin | `com_pin` → **"Redefinir PIN"**; `sem_cartao` → **"Emitir cartão"**; e "Encerrar com motivo" | **"Emitir cartão"**; e "Encerrar com motivo" |
| Aguardando cadastro do PIN | só "Encerrar com motivo" — **nenhum botão de reset ou emissão** | só "Encerrar com motivo" |
| Verificar | as providências encontradas, com data do servidor; **"Encerrar — o problema já foi resolvido"**; e **"O problema persiste: redefinir PIN"** (`com_pin`) ou **"O problema persiste: emitir cartão"** (`sem_cartao`) | as providências encontradas; **"Encerrar — o problema já foi resolvido"**; e **"O problema persiste: emitir cartão"** |

### 4.5 Os casos, pela regra

| # | caso | classificação | estado |
|---|---|---|---|
| 1 | offline às 8h, **balcão +2 dias**, PIN novo às 10h, sincroniza às 11h, sem exceção online antes | `I` = início, `S` = 11h; cadastro em `(I, S]`; credencial `com_pin` → **ambígua** | **Verificar** |
| 2 | mesmo caso, com exceção online às 7h | `I` = 7h; cadastro em `(7h, 11h]` → **ambígua** | **Verificar** |
| 3 | admin **zerou** às 10h, motoboy não cadastrou, PIN esquecido offline das 8h chega às 11h | credencial `sem_pin` → **aguardando cadastro** | **Aguardando cadastro do PIN** |
| 4 | admin **emitiu cartão** às 10h, sem PIN; cartão perdido **offline das 8h** chega às 11h | emissão em `(I, S]`, não posterior a `S` → **ambígua** | **Verificar**, mostrando a emissão das 10h ainda sem PIN; "O problema persiste: emitir cartão" |
| 5 | admin **encerrou** às 10h a exceção das 7h; PIN esquecido offline das 8h chega às 11h | encerramento em `(I, S]` → **ambígua** | **Verificar**, mostrando o encerramento |
| 6 | PIN esquecido **online** às 15h, depois de PIN cadastrado às 10h | conclusão antes de `S`; `com_pin`; online → **aberta** | **Aguardando o admin** — "Redefinir PIN" |
| 7 | PIN esquecido online às 15h com o PIN **zerado** às 12h e não cadastrado | `sem_pin` → **aguardando cadastro** | **Aguardando cadastro do PIN** |
| 8 | exceção às 9h, PIN cadastrado às 10h | conclusão depois de `S` → **resolvida** | histórico |
| **9** | **exceção ANTERIOR ao acompanhamento**; depois da implantação o admin redefine às 10h e o motoboy cadastra às 11h | cadastro às 11h `> S(e)` → **resolvida** (a classe 2 vem antes da 4) | **histórico, ligada ao `pin_cadastrado` das 11h** |
| **10** | **credencial já sem PIN no início do acompanhamento** (`inicio_sem_pin`, nada cadastrado depois); PIN esquecido online às 15h | `sem_pin` → **aguardando cadastro** | **Aguardando cadastro do PIN** — sem "Redefinir PIN" |
| **11** | **cartão emitido às 10h; o motoboy perde esse cartão antes de cadastrar o PIN; cartão perdido ONLINE às 11h** | a emissão das 10h não é posterior a `S` = 11h → nem resolvida nem aguardando; online → **aberta** | **Aguardando o admin** — "Emitir cartão" |
| 11b | mesmo cenário, mas a exceção das 11h é **PIN esquecido** | credencial ativa `sem_pin` → **aguardando cadastro** | **Aguardando cadastro do PIN** |
| 12 | exceção anterior ao acompanhamento, credencial `com_pin`, nada depois | **anterior** | **Verificar** |

O caso 11 × 11b é o que separa os dois problemas: o mesmo cartão ativo sem PIN **basta**
para o PIN esquecido esperar cadastro, e **não basta** para o cartão perdido.

---

## 5. Cartão perdido — pedido próprio, sem revogação automática

Confirmado pelo usuário: mecanismo do §4 com regras próprias. **Nada revoga o cartão
automaticamente** ao registrar a exceção; emitir o cartão novo já revoga o anterior, e
esse é o ato do admin.

**Cartão novo com PIN cadastrado depois da exceção conclui também o PIN esquecido.** O
cartão do gerente nunca conclui pedido de motoboy.

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

**Para o gerente, o estado do pedido é calculado sobre a credencial inteira**, mas a
função **não devolve** operação, romaneio, filial, gerente validador nem contagem de
outra filial.

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

- o contador vive no **cabeçalho** (`AppLayout`): atualiza a cada **60 segundos** e ao
  voltar o foco à janela, em qualquer tela;
- depois de reconectar, a primeira consulta traz tudo;
- o pedido continua aparecendo nos dias seguintes até ser concluído ou encerrado;
- abrir ou ler não encerra nada.

**Isto não é o encaminhamento em tempo real.** É uma primeira entrega para o
acompanhamento de credenciais. **O fluxo em tempo real continua pendente**, e para as
**divergências entre caixa, gestor e admin** ele é necessário.

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
esquecido continua gravado. Ela não conclui nada. **Mas o estado atual da credencial
conta** (§4.2): uma credencial que já estava sem PIN leva a "Aguardando cadastro".

Toda exceção anterior ao início que **não** for resolvida por fato posterior nem estiver
aguardando cadastro cai em **"Verificar"**, com a evidência da operação, o estado da
credencial na linha de base e os eventos `credencial_pin_*` posteriores marcados
**"registro não comprovado"**. **As 5 exceções existentes** entram por essas regras.

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

## 12. Proteção de `eventos` e `assinaturas` — PREPARADA

`supabase/migrations/20260913120000_eventos_e_assinaturas_so_do_servidor.sql`.
**Primeira das duas migrations**, decidida pelo usuário para agora.

### O que foi medido

| Quem grava em `eventos` | Tipos | Como |
|---|---|---|
| `fn_log_entrega` (gatilho `trg_entregas_log`) | `entrega_criada`, `status_alterado` | `SECURITY DEFINER` |
| `log_credencial` | `credencial_*` | `SECURITY DEFINER` |
| `selar_romaneio_interno` | `romaneio_selado` | `SECURITY DEFINER` |
| `selar_romaneio_retorno_interno` | `romaneio_retorno_selado`, `insucesso_detalhado`, `documento_faltante`, `pagamento_alterado` | `SECURITY DEFINER` |
| `registrar_conflito_romaneio` / `_retorno` | `conflito_sincronizacao`, `conflito_retorno` | `SECURITY DEFINER` |
| **cliente** (`inserirEventoIdempotente`) | **só** `pagamento_alterado`, `falta_receita`, `falta_documento_convenio`, `entrega_cancelada` | policy `eventos_insert` |
| Edge Functions | nenhum | — |

- todo escritor do servidor roda como dono da tabela; nenhuma migration usa
  `force row level security`;
- **`assinaturas` não tem escritor no cliente** desde 16/08;
- o schema inicial concedeu `insert` e `update` em todas as tabelas para
  `authenticated` — a falta de policy negava a alteração, mas o grant ficou;
- **o `pagamento_alterado` do cliente** tem `de`, `para`, `justificativa`,
  `autor_nome` e, quando há, `referencia_informada` + `origem_referencia` — **nunca
  `origem` nem `romaneio_retorno_id`**;
- **todas as versões do selo do retorno**, desde `20260820130000`, gravaram os dois
  marcadores juntos (`origem: 'romaneio_retorno'` e `romaneio_retorno_id`).

### O que a migration faz

```
eventos_insert   with check (tenant_id = current_tenant_id()
                             and tipo in ('pagamento_alterado', 'falta_receita',
                                          'falta_documento_convenio', 'entrega_cancelada')
                             and not (payload ? 'origem')
                             and not (payload ? 'romaneio_retorno_id'))
eventos          revoke update
assinaturas      policy de insert removida; revoke insert, update
```

- **`romaneio_retorno_id` e `origem` são recusados como CHAVE**, com qualquer valor,
  inclusive nulo — `?` pega a chave presente, o que `->> is null` deixaria passar;
- **`origem_referencia` continua permitido**: é outro campo, com uso legítimo (E4.1);
- a restrição vale para a escrita do cliente; **as funções de selo continuam gravando**
  os dois marcadores;
- **nenhum evento antigo é reescrito**, nem recebe origem comprovada por dedução.

**Isso protege os marcadores de origem. Não transforma o conteúdo informado pelo
operador em prova de que o pagamento ocorreu** — ele continua sendo declaração, com autor
e justificativa.

### A tela distingue pelos marcadores, nunca pelo texto

Hoje Notificações e o Registro de Auditoria mostram os dois casos igual — "Divergência de
pagamento — era X, virou Y" —, e só o **texto** da justificativa do selo ("Ninguém digitou
esta justificativa") denunciava a diferença. Texto livre não pode decidir isso.

A leitura passa a sair de uma função pura em `lib/formasDePagamento.ts`:

| payload | origem na tela |
|---|---|
| `origem = 'romaneio_retorno'` **e** `romaneio_retorno_id` presente | **"Calculada no Romaneio de Retorno"**, e o texto do sistema não aparece como "Justificativa" |
| qualquer outro | **"Informada por <autor>"**, com a justificativa dele |

Isso **lê** o que está gravado; não reescreve nem certifica o passado. Daqui para a
frente, a migration impede o cliente de produzir os marcadores.

### Conferências no rodapé da migration

(a) policies; (b) privilégios de tabela; (c) **o cliente simulado**, como
`authenticated` com a sessão de um caixa, num bloco que termina com erro de propósito — a
mensagem é o resultado e o erro garante que nada fica gravado: os três escritos do
cliente passam, e `romaneio_retorno_id` nulo, `origem` alegada, `romaneio_selado`,
`credencial_pin_definido`, assinatura e `update` em `eventos` são recusados; (d) o
servidor continua gravando, pela tela; (e) o verificador de romaneios inalterado.

**`scripts/eventos-do-cliente.spec.mts`** compara a lista de tipos da policy com o que o
fonte do cliente grava, e confirma que nenhum payload do cliente usa `origem` nem
`romaneio_retorno_id` — tipo novo de cliente sem mexer na policy fica vermelho aqui, não
em produção.

---

## 13. Aceite

### Proteção de `eventos` e `assinaturas` (primeira migration)

| cenário | esperado |
|---|---|
| cliente grava `falta_receita`, `pagamento_alterado` e um com `origem_referencia` | permitido |
| cliente grava `pagamento_alterado` com `romaneio_retorno_id` nulo | **recusado** |
| cliente grava `pagamento_alterado` com `origem: 'romaneio_retorno'` sem id | **recusado** |
| cliente grava `romaneio_selado` ou `credencial_pin_definido` | **recusado** |
| cliente insere assinatura, ou altera evento | **recusado** |
| ocorrência de pagamento pela tela | gravada, **"Informada por …"** |
| retorno com divergência | o selo grava, **"Calculada no Romaneio de Retorno"** |
| verificador de romaneios | inalterado |

### Pedidos de credencial (segunda migration)

| cenário | esperado |
|---|---|
| exceção online por PIN esquecido, credencial `com_pin` | **Aguardando o admin** — "Redefinir PIN" |
| duas sincronizações simultâneas do mesmo motoboy | as duas operações seladas; um pedido só |
| reenvio da mesma operação | nada muda |
| os casos 1 a 12 do §4.5 | exatamente o estado da tabela |
| novo esquecimento online depois de concluído | pedido novo, **Aguardando o admin** |
| troca de cartão (emitir e cadastrar PIN, depois da exceção) | cartão perdido e PIN esquecido **concluídos** |
| cartão do gerente com PIN cadastrado | não conclui pedido de motoboy |
| **gerente redefine o próprio PIN** | funciona; nenhum fato gravado |
| encerramento pelo admin | **encerrado** com motivo; PIN e cartão intactos; clicar duas vezes não duplica |
| Verificar de cartão perdido | oferece "O problema persiste: **emitir cartão**" |
| outra sessão, fora da página de Credenciais | o contador muda ao voltar o foco ou em até 60 s |
| gerente de uma filial, motoboy com operações em duas | vê o pedido e **só as operações da filial dele** |
| caixa | não vê o painel nem o contador |
| as 5 exceções existentes | classificadas pelas regras do §4, com o indício marcado como não comprovado |
| migration com as tabelas da v1 contendo uma linha | a migration **recusa** a remoção, com mensagem |
| verificador de romaneios | inalterado |
