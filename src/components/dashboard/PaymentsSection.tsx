/**
 * Panal — Historial de pagos (dashboard.md S7).
 * Lista de 6 pagos con icono de dirección, monto mono con signo y TxHash;
 * hover cream, click copia hash, exportación CSV real en cliente.
 */

import { motion } from 'framer-motion';
import { ArrowDownLeft, ArrowUpRight, Download } from 'lucide-react';
import { toast } from 'sonner';
import TxHash from '@/components/TxHash';
import { cn } from '@/lib/utils';
import { PAYMENTS } from './data';
import { formatMonEs } from './data';

function exportCsv() {
  const header = 'id,direccion,descripcion,contraparte,fecha,monto_mon,tx';
  const rows = PAYMENTS.map((p) =>
    [p.id, p.direction, `"${p.description}"`, p.counterparty, `"${p.date}"`, p.amount, p.txHash].join(','),
  );
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pagos-panal.csv';
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exportado', { description: 'pagos-panal.csv · 6 movimientos' });
}

export default function PaymentsSection() {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-paper shadow-card">
      <ul className="divide-y divide-line">
        {PAYMENTS.map((p, i) => {
          const incoming = p.direction === 'recibido';
          return (
            <motion.li
              key={p.id}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
            >
              <div className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-cream">
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                    incoming ? 'bg-olive/10 text-olive' : 'bg-sand text-ink-3',
                  )}
                  aria-hidden
                >
                  {incoming ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.9375rem] font-medium text-ink">{p.description}</p>
                  <p className="mt-0.5 font-mono text-[0.75rem] text-ink-3">
                    {p.counterparty} · {p.date}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={cn(
                      'font-mono text-[0.9375rem] font-medium',
                      incoming ? 'text-olive' : 'text-ink',
                    )}
                  >
                    {incoming ? '+' : '−'}
                    {formatMonEs(p.amount)} MON
                  </span>
                  <TxHash hash={p.txHash} className="text-[0.6875rem]" />
                </div>
              </div>
            </motion.li>
          );
        })}
      </ul>
      <div className="border-t border-line bg-cream/60 px-5 py-3">
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 py-1.5 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:border-honey hover:text-honey-deep"
        >
          <Download size={14} />
          Exportar CSV
        </button>
      </div>
    </div>
  );
}
