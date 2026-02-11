'use client';

import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, FileText, CalendarClock, Clock, AlertTriangle, CheckCircle2, XCircle, Eye } from 'lucide-react';
import ModalDetalhesEmpresa from '@/app/components/ModalDetalhesEmpresa';
import type { Empresa } from '@/app/types';
import { useSistema } from '@/app/context/SistemaContext';
import { formatBR, parseISODate, daysUntil } from '@/app/utils/date';

type EventItem = {
  date: string;
  label: string;
  company: string;
  companyId: string;
  kind: 'documento' | 'ret';
  dias: number | null;
};

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function CalendarioPage() {
  const { empresas } = useSistema();
  const [cursor, setCursor] = useState(() => new Date());

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [empresaView, setEmpresaView] = useState<Empresa | null>(null);

  const { monthLabel, gridDays, byDate, monthEventCount } = useMemo(() => {
    const base = new Date(cursor);
    const first = startOfMonth(base);
    const last = endOfMonth(base);

    const events: EventItem[] = [];
    for (const e of empresas) {
      const nome = e.razao_social || e.apelido || e.codigo;
      for (const d of e.documentos) {
        if (d.validade) {
          events.push({ date: d.validade, label: `Doc: ${d.nome}`, company: nome, companyId: e.id, kind: 'documento', dias: daysUntil(d.validade) });
        }
      }
      for (const r of e.rets) {
        if (r.vencimento) {
          events.push({ date: r.vencimento, label: `RET: ${r.nome}`, company: nome, companyId: e.id, kind: 'ret', dias: daysUntil(r.vencimento) });
        }
      }
    }

    const byDate: Record<string, EventItem[]> = {};
    for (const ev of events) {
      byDate[ev.date] = byDate[ev.date] ? [...byDate[ev.date], ev] : [ev];
    }

    const firstGrid = new Date(first);
    firstGrid.setDate(first.getDate() - first.getDay());

    const days: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(firstGrid);
      d.setDate(firstGrid.getDate() + i);
      days.push(d);
    }

    // Count events this month
    let monthCount = 0;
    for (const [dateStr, evts] of Object.entries(byDate)) {
      const d = new Date(dateStr);
      if (d.getMonth() === base.getMonth() && d.getFullYear() === base.getFullYear()) {
        monthCount += evts.length;
      }
    }

    const label = base.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

    return {
      monthLabel: label.charAt(0).toUpperCase() + label.slice(1),
      gridDays: days,
      byDate,
      monthEventCount: monthCount,
    };
  }, [cursor, empresas]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-md">
              <CalendarDays className="text-white" size={22} />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{monthLabel}</div>
              <div className="text-sm text-gray-500">{monthEventCount} vencimento(s) neste mês</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Legenda de cores */}
            <div className="flex items-center gap-3 mr-4 text-xs flex-wrap">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Vencido</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" /> Crítico (≤15d)</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Atenção (≤60d)</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Em dia</span>
            </div>
            <button
              onClick={() => setCursor(new Date())}
              className="rounded-xl bg-gray-100 px-3 py-2 text-sm font-semibold hover:bg-gray-200 transition"
            >
              Hoje
            </button>
            <button
              onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              className="rounded-xl bg-gray-100 p-2 hover:bg-gray-200 transition"
              aria-label="Mês anterior"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={() => setCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              className="rounded-xl bg-gray-100 p-2 hover:bg-gray-200 transition"
              aria-label="Próximo mês"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        <div className="flex gap-6 mt-6">
          {/* Calendar Grid */}
          <div className="flex-1">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-1">
              {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((w) => (
                <div key={w} className="text-center text-xs font-bold text-gray-400 uppercase tracking-wider py-2">
                  {w}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {gridDays.map((d) => {
                const iso = toISODate(d);
                const events = byDate[iso] ?? [];
                const isCurrentMonth = d.getMonth() === cursor.getMonth();
                const today = toISODate(new Date()) === iso;
                const isSelected = selectedDate === iso;

                // Determine worst status for the day (for dot indicator)
                const worstStatus = events.reduce((worst, ev) => {
                  if (ev.dias === null) return worst;
                  if (ev.dias < 0) return 'vencido';
                  if (ev.dias <= 15 && worst !== 'vencido') return 'critico';
                  if (ev.dias <= 60 && worst !== 'vencido' && worst !== 'critico') return 'atencao';
                  return worst;
                }, 'ok' as 'vencido' | 'critico' | 'atencao' | 'ok');

                const statusColorClass =
                  worstStatus === 'vencido' ? 'bg-red-500' :
                  worstStatus === 'critico' ? 'bg-orange-500' :
                  worstStatus === 'atencao' ? 'bg-amber-400' :
                  'bg-emerald-500';

                const eventColor = (ev: EventItem) => {
                  if (ev.dias === null) return ev.kind === 'documento' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800';
                  if (ev.dias < 0) return 'bg-red-100 text-red-800 font-bold';
                  if (ev.dias <= 15) return 'bg-orange-100 text-orange-800';
                  if (ev.dias <= 60) return 'bg-amber-100 text-amber-800';
                  return 'bg-emerald-100 text-emerald-800';
                };

                return (
                  <div
                    key={iso}
                    onClick={() => events.length > 0 && setSelectedDate(isSelected ? null : iso)}
                    className={
                      'min-h-[100px] rounded-xl p-2 transition cursor-pointer ' +
                      (!isCurrentMonth ? 'bg-gray-50/50 opacity-40' : 'bg-white hover:bg-gray-50') +
                      (today ? ' ring-2 ring-cyan-500 bg-cyan-50/30' : '') +
                      (isSelected ? ' ring-2 ring-blue-500 bg-blue-50/30' : '')
                    }
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={
                        'text-sm font-bold ' +
                        (today ? 'bg-cyan-600 text-white rounded-full h-7 w-7 flex items-center justify-center' : 'text-gray-700')
                      }>
                        {d.getDate()}
                      </span>
                      {events.length > 0 && (
                        <div className="flex items-center gap-1">
                          <span className={`h-2 w-2 rounded-full ${statusColorClass} ${worstStatus === 'vencido' ? 'animate-pulse' : ''}`} />
                          <span className="text-[10px] font-bold text-gray-400">{events.length}</span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      {events.slice(0, 2).map((ev, idx) => (
                        <div
                          key={`${iso}:${idx}`}
                          className={`rounded-lg px-1.5 py-1 text-[10px] leading-tight ${eventColor(ev)}`}
                          title={`${ev.company} • ${ev.label} • ${formatBR(ev.date)}${ev.dias !== null ? ` • ${ev.dias < 0 ? `vencido há ${Math.abs(ev.dias)}d` : `${ev.dias}d`}` : ''}`}
                        >
                          <div className="font-bold truncate">{ev.label}</div>
                          <div className="truncate opacity-70">{ev.company}</div>
                        </div>
                      ))}
                      {events.length > 2 && (
                        <div className="text-[10px] font-semibold text-cyan-600">+{events.length - 2} mais</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Side Panel - Selected Day Details */}
          {selectedDate && byDate[selectedDate] && (
            <div className="w-[320px] flex-shrink-0">
              <div className="rounded-2xl border border-gray-200 bg-white shadow-sm sticky top-24 overflow-hidden">
                <div className="bg-gradient-to-r from-teal-500 to-cyan-600 p-4 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium opacity-80">Vencimentos em</div>
                      <div className="text-lg font-bold">{formatBR(selectedDate)}</div>
                    </div>
                    <button onClick={() => setSelectedDate(null)} className="p-1 rounded-lg hover:bg-white/20 transition">
                      <XCircle size={20} />
                    </button>
                  </div>
                  <div className="text-sm mt-1">{byDate[selectedDate].length} item(ns)</div>
                </div>
                <div className="max-h-[500px] overflow-y-auto divide-y divide-gray-100">
                  {byDate[selectedDate].map((ev, idx) => {
                    const statusClass =
                      ev.dias === null ? 'text-gray-500' :
                      ev.dias < 0 ? 'text-red-600 font-bold' :
                      ev.dias <= 15 ? 'text-orange-600 font-bold' :
                      ev.dias <= 60 ? 'text-amber-600' :
                      'text-emerald-600';

                    const statusText =
                      ev.dias === null ? '' :
                      ev.dias < 0 ? `VENCIDO HÁ ${Math.abs(ev.dias)}d` :
                      ev.dias === 0 ? 'VENCE HOJE!' :
                      `${ev.dias}d restantes`;

                    const StatusIcon =
                      ev.dias !== null && ev.dias < 0 ? XCircle :
                      ev.dias !== null && ev.dias <= 15 ? AlertTriangle :
                      ev.dias !== null && ev.dias <= 60 ? Clock :
                      CheckCircle2;

                    return (
                      <div key={idx} className="p-4 hover:bg-gray-50 transition">
                        <div className="flex items-start gap-3">
                          <div className={`mt-0.5 ${statusClass}`}>
                            <StatusIcon size={18} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold text-gray-900 truncate">{ev.company}</div>
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className={`text-xs px-1.5 py-0.5 rounded-md font-semibold ${
                                ev.kind === 'documento' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                              }`}>
                                {ev.kind === 'documento' ? 'DOC' : 'RET'}
                              </span>
                              <span className="text-xs text-gray-600 truncate">{ev.label}</span>
                            </div>
                            {ev.dias !== null && (
                              <div className={`text-xs mt-1.5 ${statusClass}`}>
                                {statusText}
                              </div>
                            )}
                            <button
                              onClick={() => {
                                const emp = empresas.find((e) => e.id === ev.companyId);
                                if (emp) setEmpresaView(emp);
                              }}
                              className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-cyan-600 hover:text-cyan-800 transition"
                            >
                              <Eye size={14} />
                              Ver detalhes da empresa
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {empresaView && <ModalDetalhesEmpresa empresa={empresaView} onClose={() => setEmpresaView(null)} />}
    </div>
  );
}
