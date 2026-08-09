import { supabase } from '@/lib/supabase'

// eventos.id é bigint gerado pelo banco — não dá pra usar id determinístico
// nem upsert sem abrir policy de UPDATE (quebraria o append-only da regra 6
// do CLAUDE.md). Em vez disso, quem chama gera uma idempotency_key uma
// única vez (antes de enfileirar); aqui checa se já existe antes de
// inserir, pra reenvio da fila offline nunca duplicar o evento.
export async function inserirEventoIdempotente(input: {
  tenantId: string
  entregaId?: string | null
  corridaId?: string | null
  tipo: string
  payload: Record<string, unknown>
  registradoPor: string
  idempotencyKey: string
}): Promise<void> {
  const { data, error: selectError } = await supabase
    .from('eventos')
    .select('id')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle()
  if (selectError) throw selectError
  if (data) return

  const { error } = await supabase.from('eventos').insert({
    tenant_id: input.tenantId,
    entrega_id: input.entregaId ?? null,
    corrida_id: input.corridaId ?? null,
    tipo: input.tipo,
    payload: input.payload,
    idempotency_key: input.idempotencyKey,
    user_id: input.registradoPor,
  })
  if (error) throw error
}
