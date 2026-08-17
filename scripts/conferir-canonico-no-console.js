// NÃO roda com node. Isto é pra colar no console do navegador (F12 →
// Console), com o app aberto e você logado.
//
// O QUE ELE PROVA
//
// Que `montarCanonico` (src/lib/canonico.ts, TypeScript) e
// `romaneio_canonico` (migration 20260816140000, SQL) produzem os MESMOS
// BYTES a partir dos mesmos vales.
//
// Isso importa porque o hash do romaneio sai dessas duas implementações:
// online o servidor calcula, offline o navegador calcula, e na
// sincronização o servidor recalcula e compara. Se divergirem em um byte
// só, o sintoma não é um erro claro — é "a saída offline nunca
// sincroniza", meses depois, sem pista.
//
// Vale rodar de novo sempre que alguém mexer em QUALQUER um dos dois
// lados. É a única defesa real contra essa divergência.

const { supabase } = await import('/src/lib/supabase.ts')
const { prepararRomaneio, conferirCanonico } = await import('/src/data/romaneios.ts')

// 1. quem está logado
const {
  data: { user },
} = await supabase.auth.getUser()
if (!user) throw new Error('Faça login primeiro.')

const { data: perfil } = await supabase
  .from('profiles')
  .select('tenant_id, loja_id')
  .eq('id', user.id)
  .single()

// 2. um motoboy que tenha agência
const { data: moto } = await supabase
  .from('mototaxistas')
  .select('id, agencia_id')
  .eq('ativo', true)
  .not('agencia_id', 'is', null)
  .limit(1)
  .maybeSingle()
if (!moto) throw new Error('Nenhum motoboy ativo com agência. Cadastra um em Cadastros.')

// 3. até 3 vales pendentes sem corrida (a RLS já limita à sua filial)
const { data: entregas } = await supabase
  .from('entregas')
  .select(
    'id, numero_vale, tipo, cliente_nome, cliente_endereco, quantidade_vales, ' +
      'valor_compra_cents, valor_entrega_cents, entrega_paga_cliente_cents, ' +
      'loja_origem_id, convenio_id'
  )
  .eq('status_entrega', 'pendente')
  .is('corrida_id', null)
  .limit(3)

if (!entregas || entregas.length === 0) {
  throw new Error('Nenhum vale pendente sem corrida. Lança um vale novo e roda de novo.')
}
const entregaIds = entregas.map((e) => e.id)

// 4. os pagamentos previstos desses vales (transferência não tem nenhum)
const { data: pagamentos } = await supabase
  .from('pagamentos')
  .select('id, entrega_id, forma, valor_cents, troco_cents')
  .in('entrega_id', entregaIds)
  .eq('momento', 'previsto')

// 5. monta a entrada canônica do lado do cliente
const entrada = {
  tenantId: perfil.tenant_id,
  lojaId: perfil.loja_id,
  agenciaId: moto.agencia_id,
  motoboyId: moto.id,
  caixaId: user.id, // preparar_romaneio usa auth.uid() — tem que ser o mesmo
  vales: entregas.map((e) => ({
    entregaId: e.id,
    numeroVale: e.numero_vale,
    tipo: e.tipo,
    clienteNome: e.cliente_nome,
    clienteEndereco: e.cliente_endereco,
    quantidadeVales: e.quantidade_vales,
    valorCompraCents: e.valor_compra_cents,
    valorEntregaCents: e.valor_entrega_cents,
    entregaPagaClienteCents: e.entrega_paga_cliente_cents,
    lojaOrigemId: e.loja_origem_id,
    convenioId: e.convenio_id,
    pagamentosPrevistos: (pagamentos ?? [])
      .filter((p) => p.entrega_id === e.id)
      .map((p) => ({
        pagamentoId: p.id,
        forma: p.forma,
        valorCents: p.valor_cents,
        trocoCents: p.troco_cents,
      })),
  })),
}

// 6. pede o do servidor e compara byte a byte
const preparado = await prepararRomaneio({
  lojaId: entrada.lojaId,
  agenciaId: entrada.agenciaId,
  motoboyId: entrada.motoboyId,
  entregaIds,
})

const r = conferirCanonico(entrada, preparado)

if (r.iguais) {
  console.log(`OK — os dois lados concordam (${r.local.length} bytes, ${entregas.length} vale(s))`)
  console.log(r.local.replace(/\t/g, ' ⇥ '))
} else {
  const de = Math.max(0, r.primeiraDiferenca - 60)
  const ate = r.primeiraDiferenca + 60
  console.error(`DIVERGEM no byte ${r.primeiraDiferenca}`)
  console.log('local   :', JSON.stringify(r.local.slice(de, ate)))
  console.log('servidor:', JSON.stringify(r.servidor.slice(de, ate)))
}

r
