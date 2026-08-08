// Único lugar do código que converte entre string digitada e centavos.
// Dinheiro é sempre integer _cents daqui pra frente — nunca float.

export function toCents(input: string): number {
  const trimmed = input.trim()
  if (!trimmed) return 0

  const negative = trimmed.startsWith('-')
  const digits = trimmed.replace(/[^\d,.]/g, '')
  if (!digits) return 0

  const lastSep = Math.max(digits.lastIndexOf(','), digits.lastIndexOf('.'))

  let reaisPart: string
  let centsPart: string
  if (lastSep === -1) {
    reaisPart = digits
    centsPart = '00'
  } else {
    reaisPart = digits.slice(0, lastSep)
    centsPart = digits.slice(lastSep + 1).padEnd(2, '0').slice(0, 2)
  }

  reaisPart = reaisPart.replace(/[,.]/g, '')
  const cents = (parseInt(reaisPart || '0', 10) || 0) * 100 + (parseInt(centsPart, 10) || 0)
  return negative ? -cents : cents
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
