# Pendência "Redefinir PIN" — o ponto do 4B que não foi construído

13/09/2026, **proposta, nada aplicado**. Fecha o §5 do
[desenho do 4B](desenho-4b-2026-09-11.md), confirmado pelo usuário em 11/09:
*quando o gerente autoriza por PIN esquecido, o admin precisa ser avisado*.

Hoje o motivo fica gravado no documento (`assinaturas.motivo_excecao`) e **ninguém é
avisado**: o admin só descobre que um motoboy está sem PIN abrindo romaneio por
romaneio.

## O que o §5 exige, e como cada exigência é atendida

| Exigência do desenho | Como |
|---|---|
| uma pendência aberta por tenant, motoboy e tipo | índice único parcial `(tenant_id, motoboy_id, tipo) where atendida_em is null` |
| operações ligadas, e **repetir a sincronização não duplica** | tabela de vínculo com **chave primária na assinatura**: cada evidência liga uma vez só |
| guarda quem pediu, qual gerente autorizou, quais operações | derivado do vínculo: filial, romaneio, gerente e a confirmação da farmácia de cada operação |
| **nasce no servidor, a partir do registro autorizado** | gatilho `after insert` em `assinaturas`. Conflito não grava assinatura, então **tentativa recusada nunca vira pedido** — por construção, não por checagem |
| offline, a tela diz que o pedido **aguarda sincronização** | texto da tela; a pendência só existe quando o selo existir |
| atendimento ligado à **redefinição efetiva**, não a ter lido | gatilho em `eventos` sobre `credencial_pin_redefinido` e `credencial_pin_definido`, que só `log_credencial` escreve |
| o painel distingue **reset feito** de **PIN novo cadastrado** | duas colunas: `pin_redefinido_em` e `atendida_em` |
| operação que sincroniza depois **não reabre** o que já foi tratado | se não há pendência aberta, mas há uma atendida **depois** do relógio do balcão daquela operação, a operação liga-se a ela como `chegou_depois` |

**Por que gatilho, e não mexer nas funções de selo:** `selar_romaneio_interno` e
`selar_romaneio_retorno_interno` são as funções mais críticas do projeto, e a regra
já escrita é não reabri-las por algo que não muda o documento. O gatilho roda na
**mesma transação** do selo — se o selo cair, a pendência cai junto — e não toca em
hash nenhum.

**A ressalva do relógio, escrita antes de alguém tropeçar nela:** "chegou depois"
compara o relógio do **balcão** da operação offline com o do **servidor** do
atendimento. Um PC 40 minutos errado pode abrir uma pendência que já estava tratada, ou
deixar de abrir uma nova. O primeiro caso é visível e o admin encerra; o segundo só
acontece se o motoboy esqueceu o PIN de novo nesses 40 minutos.

## O SQL das tabelas — para confirmação antes de criar

```sql
-- UM PEDIDO por motoboy e tipo enquanto estiver aberto.
create table public.pendencias_credencial (
  -- Nasce no servidor, dentro do selo — não há id de cliente a preservar.
  -- Mesmo arranjo de `eventos.id`.
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id),
  motoboy_id          uuid not null references public.mototaxistas(id),
  -- Só PIN esquecido. `cartao_perdido` fica de fora até ser decidido (abaixo);
  -- o CHECK amplia sem migrar dado.
  tipo                text not null check (tipo in ('redefinir_pin')),
  aberta_em           timestamptz not null default now(),
  -- O admin ZEROU o PIN (`redefinir_pin`). Ainda não é atendimento: o motoboy
  -- precisa cadastrar o novo, com o cartão, online.
  pin_redefinido_em   timestamptz,
  pin_redefinido_por  uuid references public.profiles(id),
  -- O motoboy CADASTROU o PIN novo (`definir_pin`). Aqui encerra.
  atendida_em         timestamptz,
  constraint pendencia_redefinida_tem_autor check (
    (pin_redefinido_em is null) = (pin_redefinido_por is null)),
  constraint pendencia_atendida_depois check (
    atendida_em is null or atendida_em >= aberta_em)
);

create unique index pendencias_credencial_uma_aberta
  on public.pendencias_credencial (tenant_id, motoboy_id, tipo)
  where atendida_em is null;


-- CADA OPERAÇÃO AUTORIZADA POR PIN ESQUECIDO, ligada a um pedido.
create table public.pendencia_credencial_operacoes (
  -- A evidência do motoboy daquela operação. Chave primária = reenvio,
  -- sincronização repetida e selo idempotente não duplicam nada.
  assinatura_id       uuid primary key references public.assinaturas(id),
  pendencia_id        uuid not null references public.pendencias_credencial(id),
  tenant_id           uuid not null references public.tenants(id),
  loja_id             uuid not null references public.lojas(id),
  romaneio_id         uuid not null references public.romaneios(id),
  gerente_id          uuid not null references public.profiles(id),
  -- A operação offline que sincronizou DEPOIS de o pedido ter sido atendido.
  chegou_depois       boolean not null default false,
  vinculada_em        timestamptz not null default now()
);

create index on public.pendencia_credencial_operacoes (pendencia_id);


-- RLS: leitura do tenant; o admin vê tudo, o gerente vê o que envolve a
-- filial dele. NINGUÉM escreve direto — só os dois gatilhos, que são
-- SECURITY DEFINER. Tabela nova nasce com grant total no Supabase, então
-- o revoke não é decorativo.
alter table public.pendencias_credencial          enable row level security;
alter table public.pendencia_credencial_operacoes enable row level security;
revoke all on public.pendencias_credencial          from anon, authenticated;
revoke all on public.pendencia_credencial_operacoes from anon, authenticated;
grant select on public.pendencias_credencial          to authenticated;
grant select on public.pendencia_credencial_operacoes to authenticated;

create policy pendencia_operacoes_select on public.pendencia_credencial_operacoes
  for select using (
    tenant_id = public.current_tenant_id()
    and (public.is_admin() or loja_id = public.current_loja_id())
  );

create policy pendencias_select on public.pendencias_credencial
  for select using (
    tenant_id = public.current_tenant_id()
    and (
      public.is_admin()
      or exists (select 1 from public.pendencia_credencial_operacoes o
                  where o.pendencia_id = pendencias_credencial.id
                    and o.loja_id = public.current_loja_id())
    )
  );
```

## Os dois gatilhos — vêm na migration, com as conferências no rodapé

```
after insert on assinaturas
  when tipo_signatario = 'motoboy' and motivo_excecao = 'pin_esquecido'
    pendência aberta do motoboy?               → liga a ela
    senão, atendida depois de assinado_em_local? → liga a ela, chegou_depois
    senão                                       → abre uma e liga

after insert on eventos
  when tipo in ('credencial_pin_redefinido', 'credencial_pin_definido')
    credencial do evento é de MOTOBOY? (a do gerente não tem pedido)
    redefinido → pin_redefinido_em/por na pendência aberta
    definido   → atendida_em na pendência aberta
```

`definir_pin` num **cartão novo** também atende: o que o pedido pede é o motoboy
voltar a ter PIN, e ele voltou.

## O que a tela ganha, depois de aplicado

- **Cadastros › Credenciais (admin):** "Pedidos de redefinição de PIN" no topo, com
  motoboy, desde quando, as operações (romaneio, filial, gerente) e o estado —
  *aguardando o admin*, *PIN zerado, falta o motoboy cadastrar o novo* ou *atendido*
  —, e o botão **Redefinir PIN** que já existe.
- **Notificações (admin):** a contagem de pedidos abertos.
- **Fim da saída e do retorno com o gerente, por PIN esquecido:** online, *"O admin foi
  avisado para redefinir o PIN de João Silva"*; offline, *"O pedido de redefinição do
  PIN vai ao admin quando este registro sincronizar"*.

## Decisão sua

**Cartão perdido também abre pedido?** O §5 deixou como proposta não confirmada:
revogar o cartão e emitir outro. A recomendação é **sim, como tipo próprio**
(`reemitir_cartao`), atendido quando uma credencial nova do motoboy é emitida — e
**nunca revogando o cartão automaticamente** ao registrar a exceção. Se não, fica só
PIN esquecido, como está acima.
