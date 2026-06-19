'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ListChecks, Search, XCircle, ChevronLeft, ChevronRight, Check, X, Calendar,
  Paperclip, FileText, MessageSquare, Send, Upload, Trash2, Eye, Loader2, ShieldAlert,
  History, MailCheck, MailX,
} from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import type {
  ChecklistCadastroItem, Empresa, UUID,
  CadastroCertidao, CadastroCertidaoColuna, CadastroResultado, CadastroStatus,
} from '@/app/types';
import { CADASTRO_CERTIDAO_COLUNAS, CADASTRO_CERTIDAO_LABEL } from '@/app/types';
import * as db from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { sortByPtBr } from '@/lib/sort';
import { getDepartamentoSlugsDoUsuario } from '@/app/utils/departamento';
import { DepartamentoTabs, DEPARTAMENTO_CONFIG } from '@/app/components/DepartamentoPlaceholder';
import GestaoCertidoes from './GestaoCertidoes';
import { extrairTextoPdf } from '@/app/utils/extrairTextoPdf';
import { extrairDetalhesCertidao, emissaoDoTexto, resultadoDoTexto } from '@/app/api/checklist-cadastro/auto-registrar/_detectar';
import {
  celulasDaColuna, colunaDaCertidao, corCelulaCadastro, certidaoPodeEnviar, ufDaEmpresa,
  resultadosPermitidos, buildCadastroKey, type CelulaCertidao, type CorCelulaCadastro,
} from '@/app/utils/certidoes';
import { useFileDropZone } from '@/app/hooks/useFileDropZone';
import { formatBR, formatDateTimeBR } from '@/app/utils/date';
import { formatarDocumento } from '@/app/utils/validation';

// ── Mês ──────────────────────────────────────────────────────────────────────
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function currentMonth(): string {
  return monthKey(new Date());
}
function parseMonth(mes: string): Date {
  const [y, m] = mes.split('-').map((x) => Number(x));
  return new Date(y, (m || 1) - 1, 1);
}
function shiftMonth(mes: string, delta: number): string {
  const d = parseMonth(mes);
  d.setMonth(d.getMonth() + delta);
  return monthKey(d);
}
function monthLabel(mes: string): string {
  return parseMonth(mes).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

// ── Cores das células — por RESULTADO ─────────────────────────────────────────
// negativa=verde · pen=âmbar · positiva=vermelho · relatório=azul · tem=cinza · falta=neutro
const CELL_STYLE: Record<CorCelulaCadastro, { cell: string; dot: string; legenda: string }> = {
  negativa:  { cell: 'bg-emerald-50 border-emerald-300 hover:border-emerald-500 text-emerald-700', dot: 'bg-emerald-500', legenda: 'Negativa' },
  pen:       { cell: 'bg-amber-50 border-amber-300 hover:border-amber-400 text-amber-700',         dot: 'bg-amber-500',   legenda: 'P.E.N.' },
  positiva:  { cell: 'bg-red-50 border-red-300 hover:border-red-400 text-red-700',                 dot: 'bg-red-500',     legenda: 'Positiva' },
  relatorio: { cell: 'bg-sky-50 border-sky-300 hover:border-sky-400 text-sky-700',                 dot: 'bg-sky-500',     legenda: 'Relatório' },
  tem:       { cell: 'bg-slate-50 border-slate-300 hover:border-slate-400 text-slate-600',         dot: 'bg-slate-400',   legenda: 'Sem classificar' },
  falta:     { cell: 'bg-[var(--surface-2)] border-[var(--border)] hover:border-[var(--border-strong)] text-[var(--text-3)]', dot: 'bg-[var(--text-3)]', legenda: 'Falta' },
};

const RESULTADO_ABBR: Record<CadastroResultado, string> = { Negativa: 'Neg', PEN: 'P.E.N.', Positiva: 'Pos' };

type CellTarget = { empresa: Empresa; certidao: CadastroCertidao; coluna: CadastroCertidaoColuna; subLabel?: string };

// Cache em memória (nível de módulo) das células por mês. Sobrevive à navegação
// entre rotas — o componente desmonta, mas o módulo não. Sem isso, voltar pra
// tela recarregava tudo do zero (spinner de tela cheia) toda vez. Com cache:
// mostra na hora o que já tinha e revalida em 2º plano (stale-while-revalidate).
// Some num reload de página (F5), que é o comportamento esperado.
const cacheCelulasPorMes = new Map<string, Map<string, ChecklistCadastroItem>>();

export default function ControleCadastroPage() {
  const {
    empresas, departamentos, currentUser, currentUserId,
    canAdmin, isPrivileged, authReady, mostrarAlerta,
  } = useSistema();

  const podeVer = !!currentUser && (canAdmin || isPrivileged
    || getDepartamentoSlugsDoUsuario(currentUser, departamentos).includes('cadastro'));

  const [abaInterna, setAbaInterna] = useState<'checklist' | 'gestao'>('checklist');
  const [mes, setMes] = useState<string>(() => currentMonth());
  const [items, setItems] = useState<Map<string, ChecklistCadastroItem>>(
    () => cacheCelulasPorMes.get(currentMonth()) ?? new Map(),
  );
  // Spinner de tela cheia só quando NÃO há nada em cache pra exibir.
  const [loading, setLoading] = useState(() => !cacheCelulasPorMes.has(currentMonth()));
  const [search, setSearch] = useState('');
  const [filtroUf, setFiltroUf] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'negativa' | 'pen' | 'positiva' | 'falta'>('todos');
  const [paginaTamanho, setPaginaTamanho] = useState(50);

  // Modal da célula
  const [target, setTarget] = useState<CellTarget | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [obsLocal, setObsLocal] = useState('');
  const [relatorioLocal, setRelatorioLocal] = useState('');
  const [carregandoUrl, setCarregandoUrl] = useState(false);
  const [precisaMotivo, setPrecisaMotivo] = useState(false);
  const [motivoReenvio, setMotivoReenvio] = useState('');

  const podeApagarHistorico = (currentUser?.email ?? '').toLowerCase() === 'admin@triarcontabilidade.com.br';

  const mostrarAlertaRef = useRef(mostrarAlerta);
  useEffect(() => { mostrarAlertaRef.current = mostrarAlerta; }, [mostrarAlerta]);

  const carregar = useCallback(async (mesAlvo: string) => {
    // Com cache, revalida em silêncio (sem spinner). Sem cache, mostra spinner.
    if (!cacheCelulasPorMes.has(mesAlvo)) setLoading(true);
    try {
      const lista = await db.fetchChecklistCadastroByMes(mesAlvo);
      const mapa = new Map<string, ChecklistCadastroItem>();
      for (const it of lista) mapa.set(buildCadastroKey(it.empresaId, it.certidao), it);
      cacheCelulasPorMes.set(mesAlvo, mapa);
      setItems(mapa);
    } catch (err) {
      console.error('[cadastro] erro ao carregar:', err);
      mostrarAlertaRef.current('Erro ao carregar', 'Não foi possível carregar o checklist deste mês.', 'erro');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!podeVer) { setLoading(false); return; }
    // Mostra na hora o que já tem em cache pra este mês (se tiver) e revalida.
    const cached = cacheCelulasPorMes.get(mes);
    setItems(cached ?? new Map());
    setLoading(!cached);
    carregar(mes);
  }, [mes, carregar, podeVer]);

  // Realtime — atualiza quando outra pessoa mexe numa célula
  useEffect(() => {
    if (!podeVer) return;
    const channel = supabase
      .channel(`checklist-cadastro-${mes}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checklist_cadastro', filter: `mes=eq.${mes}` }, (payload: any) => {
        const row = payload.new ?? payload.old;
        if (!row) return;
        if (payload.eventType === 'DELETE') {
          setItems((prev) => {
            const next = new Map(prev);
            next.delete(buildCadastroKey(row.empresa_id, row.certidao));
            cacheCelulasPorMes.set(mes, next);
            return next;
          });
        } else {
          const item = db.toChecklistCadastroItem(row);
          setItems((prev) => {
            const next = new Map(prev);
            next.set(buildCadastroKey(item.empresaId, item.certidao), item);
            cacheCelulasPorMes.set(mes, next);
            return next;
          });
        }
      })
      .subscribe();
    const onVisible = () => { if (document.visibilityState === 'visible') carregar(mes); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [mes, carregar, podeVer]);

  const targetItem = target ? items.get(buildCadastroKey(target.empresa.id, target.certidao)) : undefined;

  // Sincroniza os campos de texto do modal quando o alvo muda
  useEffect(() => {
    if (!target) return;
    const it = items.get(buildCadastroKey(target.empresa.id, target.certidao));
    setObsLocal(it?.observacao ?? '');
    setRelatorioLocal(it?.relatorioTexto ?? '');
    setPrecisaMotivo(false);
    setMotivoReenvio('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.empresa.id, target?.certidao]);

  const abrirCelula = (empresa: Empresa, certidao: CadastroCertidao, coluna: CadastroCertidaoColuna, subLabel?: string) => {
    setTarget({ empresa, certidao, coluna, subLabel });
  };
  const fecharCelula = () => { if (!salvando) setTarget(null); };

  const patchItem = (it: ChecklistCadastroItem) => {
    setItems((prev) => {
      const next = new Map(prev);
      next.set(buildCadastroKey(it.empresaId, it.certidao), it);
      cacheCelulasPorMes.set(mes, next);
      return next;
    });
  };

  const definirResultado = async (resultado: CadastroResultado | null) => {
    if (!target) return;
    setSalvando(true);
    try {
      const salvo = await db.upsertChecklistCadastro({
        empresaId: target.empresa.id, certidao: target.certidao, mes,
        resultado, fonte: 'manual',
      });
      patchItem(salvo);
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível salvar o resultado.', 'erro');
    } finally { setSalvando(false); }
  };

  const definirStatus = async (status: CadastroStatus | null) => {
    if (!target) return;
    setSalvando(true);
    try {
      const salvo = await db.upsertChecklistCadastro({
        empresaId: target.empresa.id, certidao: target.certidao, mes,
        status, fonte: 'manual',
      });
      patchItem(salvo);
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível salvar o status.', 'erro');
    } finally { setSalvando(false); }
  };

  const salvarObservacao = async () => {
    if (!target) return;
    setSalvando(true);
    try {
      const salvo = await db.upsertChecklistCadastro({
        empresaId: target.empresa.id, certidao: target.certidao, mes,
        observacao: obsLocal.trim() || null,
      });
      patchItem(salvo);
      mostrarAlerta('Salvo', 'Observação registrada.', 'sucesso');
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível salvar a observação.', 'erro');
    } finally { setSalvando(false); }
  };

  const salvarRelatorioTexto = async () => {
    if (!target) return;
    setSalvando(true);
    try {
      const salvo = await db.upsertChecklistCadastro({
        empresaId: target.empresa.id, certidao: target.certidao, mes,
        relatorioTexto: relatorioLocal.trim() || null,
      });
      patchItem(salvo);
      mostrarAlerta('Salvo', 'Relatório registrado.', 'sucesso');
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível salvar o relatório.', 'erro');
    } finally { setSalvando(false); }
  };

  const fazerUpload = async (file: File, slot: 'arquivo' | 'relatorio') => {
    if (!target) return;
    setSalvando(true);
    try {
      // Upload manual de CERTIDÃO (slot 'arquivo') roda o MESMO parser do watcher:
      // lê validade/número/órgão/código/resultado do texto do PDF. Best-effort —
      // se a extração falhar (PDF escaneado), anexa mesmo assim sem os detalhes.
      let detalhes: db.DetalhesUploadCadastro | undefined;
      const ehPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (slot === 'arquivo' && ehPdf) {
        try {
          const { texto } = await extrairTextoPdf(file);
          const emissao = emissaoDoTexto(texto);
          const det = extrairDetalhesCertidao(texto, target.certidao, emissao);
          detalhes = { ...det, emissaoEm: emissao, resultado: resultadoDoTexto(texto) };
        } catch (e) {
          console.warn('[cadastro] não extraí os detalhes do PDF (anexo segue):', e);
        }
      }
      const r = await db.uploadCadastroAnexo(
        target.empresa.id, target.certidao, mes, file, slot,
        { autorId: currentUserId, autorNome: currentUser?.nome },
        detalhes,
      );
      patchItem(r.item);
      const venceu = slot === 'arquivo' && r.item.validadeEm;
      mostrarAlerta(
        'Anexado',
        slot === 'arquivo'
          ? (venceu ? `Certidão anexada. Validade lida: ${formatBR(r.item.validadeEm!)}.` : 'Certidão anexada.')
          : 'Relatório anexado.',
        'sucesso',
      );
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Erro ao anexar';
      mostrarAlerta('Erro ao anexar', msg, 'erro');
    } finally { setSalvando(false); }
  };

  const removerAnexo = async (slot: 'arquivo' | 'relatorio') => {
    if (!target) return;
    if (!window.confirm(`Remover ${slot === 'arquivo' ? 'a certidão' : 'o relatório'} anexado?`)) return;
    setSalvando(true);
    try {
      const it = await db.removeCadastroAnexo(
        target.empresa.id, target.certidao, mes, slot,
        { autorId: currentUserId, autorNome: currentUser?.nome },
      );
      patchItem(it);
      mostrarAlerta('Removido', 'Anexo excluído.', 'sucesso');
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível remover o anexo.', 'erro');
    } finally { setSalvando(false); }
  };

  const abrirArquivo = async (slot: 'arquivo' | 'relatorio') => {
    const url = slot === 'arquivo' ? targetItem?.arquivoUrl : targetItem?.relatorioUrl;
    if (!url) return;
    setCarregandoUrl(true);
    try {
      const signed = await db.getCadastroArquivoSignedUrl(url);
      window.open(signed, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível abrir o arquivo.', 'erro');
    } finally { setCarregandoUrl(false); }
  };

  // Envio / reenvio ao cliente (e-mail do CADASTRO)
  const enviarAoCliente = async (forcarReenvio: boolean) => {
    if (!target || !targetItem?.arquivoUrl || !targetItem?.arquivoNome) {
      mostrarAlerta('Sem certidão', 'Anexe a certidão (PDF) antes de enviar.', 'erro');
      return;
    }
    if (!certidaoPodeEnviar(target.coluna, targetItem.resultado)) {
      mostrarAlerta('Não enviável', 'Só Negativa e Positiva com efeito de negativa são enviadas (Trabalhista e FGTS, só Negativa).', 'erro');
      return;
    }
    if (forcarReenvio && motivoReenvio.trim().length < 10) {
      mostrarAlerta('Motivo obrigatório', 'Descreva o motivo do reenvio (mínimo 10 caracteres).', 'erro');
      return;
    }
    setSalvando(true);
    try {
      const pre = await db.prepararEnvioCadastro(target.empresa.id);
      if (!pre.ok) { mostrarAlerta('Não foi possível enviar', pre.mensagem, 'erro'); return; }
      const env = await db.enviarCadastro({
        empresaId: target.empresa.id, mes, certidao: target.certidao,
        arquivoPath: targetItem.arquivoUrl, arquivoNome: targetItem.arquivoNome,
        resultado: targetItem.resultado, checklistId: targetItem.id,
        confirmarReenvio: forcarReenvio || undefined,
        motivoReenvio: forcarReenvio ? motivoReenvio.trim() : undefined,
      });
      if (!env.ok && env.code === 'duplicado' && !forcarReenvio) {
        setPrecisaMotivo(true);
        mostrarAlerta('Já enviado', 'Esta certidão já foi enviada. Informe o motivo do reenvio para continuar.', 'aviso');
        return;
      }
      const reg = await db.registrarEnvioCadastro({
        empresaId: target.empresa.id, certidao: target.certidao, mes,
        evento: {
          id: env.ok ? env.envioId : undefined,
          enviadoEm: env.ok ? env.enviadoEm : new Date().toISOString(),
          enviadoPorId: currentUserId, enviadoPorNome: currentUser?.nome,
          remetenteEmail: env.ok ? env.de : pre.remetenteEmail,
          destinatarios: env.ok ? env.enviadoPara : pre.destinatarios,
          arquivoNome: targetItem.arquivoNome,
          motivoReenvio: forcarReenvio ? motivoReenvio.trim() : undefined,
          sucesso: env.ok,
          erro: env.ok ? undefined : env.mensagem,
          gmailMessageId: env.ok ? env.gmailMessageId : undefined,
          gmailThreadId: env.ok ? env.gmailThreadId : undefined,
          entregaStatus: env.ok ? 'pendente' : undefined,
        },
        marcarComoFeito: env.ok,
        autor: { autorId: currentUserId, autorNome: currentUser?.nome },
      });
      patchItem(reg);
      setPrecisaMotivo(false);
      setMotivoReenvio('');
      if (env.ok) {
        mostrarAlerta('Enviado!', `Certidão enviada para ${env.enviadoPara.join(', ')}.`, 'sucesso');
      } else {
        mostrarAlerta('Falha no envio', env.mensagem, 'erro');
      }
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      mostrarAlerta('Erro', msg, 'erro');
    } finally { setSalvando(false); }
  };

  const removerEnvio = async (envioId: UUID) => {
    if (!target || !podeApagarHistorico) return;
    if (!window.confirm('Apagar este envio do histórico? Não dá pra desfazer.')) return;
    try {
      const it = await db.removerEnvioCadastro(target.empresa.id, target.certidao, mes, envioId);
      patchItem(it);
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível apagar o envio.', 'erro');
    }
  };

  const { isDragging: certDrag, dragHandlers: certDragHandlers } = useFileDropZone({
    onFile: (f) => void fazerUpload(f, 'arquivo'),
    disabled: salvando,
  });

  // ── Filtros / linhas ──────────────────────────────────────────────────────
  const ufOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of empresas) {
      if (e.cadastrada === false) continue;
      const uf = ufDaEmpresa(e);
      if (uf) set.add(uf);
    }
    return Array.from(set).sort();
  }, [empresas]);

  const linhas = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDig = q.replace(/\D/g, ''); // só compara CNPJ se a busca TEM dígitos —
    // senão "".includes("") seria sempre true e não filtraria nada (bug do nome).
    let list = empresas.filter((e) => e.cadastrada !== false);
    if (q) {
      list = list.filter((e) =>
        (e.codigo ?? '').toLowerCase().includes(q) ||
        (e.razao_social ?? '').toLowerCase().includes(q) ||
        (e.apelido ?? '').toLowerCase().includes(q) ||
        (qDig.length > 0 && (e.cnpj ?? '').replace(/\D/g, '').includes(qDig)));
    }
    if (filtroUf) list = list.filter((e) => ufDaEmpresa(e) === filtroUf);
    if (filtroStatus !== 'todos') {
      list = list.filter((e) =>
        CADASTRO_CERTIDAO_COLUNAS.some((coluna) =>
          celulasDaColuna(coluna, e).some((cel) =>
            corCelulaCadastro(items.get(buildCadastroKey(e.id, cel.certidao))) === filtroStatus)));
    }
    return sortByPtBr(list, (e) => e.apelido || e.razao_social || e.codigo || '');
  }, [empresas, search, filtroUf, filtroStatus, items]);

  useEffect(() => { setPaginaTamanho(50); }, [search, filtroUf, filtroStatus, mes]);

  const visiveis = linhas.slice(0, paginaTamanho);

  // Stats por resultado (sobre as células visíveis)
  const stats = useMemo(() => {
    let negativa = 0, pen = 0, positiva = 0, falta = 0, total = 0;
    for (const e of linhas) {
      for (const coluna of CADASTRO_CERTIDAO_COLUNAS) {
        for (const cel of celulasDaColuna(coluna, e)) {
          total++;
          const cor = corCelulaCadastro(items.get(buildCadastroKey(e.id, cel.certidao)));
          if (cor === 'negativa') negativa++;
          else if (cor === 'pen') pen++;
          else if (cor === 'positiva') positiva++;
          else if (cor === 'falta') falta++;
        }
      }
    }
    return { negativa, pen, positiva, falta, total };
  }, [linhas, items]);

  // ── Guards (depois de todos os hooks) ───────────────────────────────────────
  if (!authReady) return null;
  if (!podeVer) {
    return (
      <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-6 sm:p-8 border border-[var(--border)] text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-md bg-[var(--danger-soft)] text-[var(--danger)]">
          <ShieldAlert size={26} />
        </div>
        <div className="text-lg font-bold text-[var(--text-1)]">Acesso restrito</div>
        <div className="mt-1 text-sm text-[var(--text-2)]">Esta área é exclusiva do departamento Cadastro.</div>
      </div>
    );
  }

  const isMesAtual = mes === currentMonth();

  return (
    <div className="space-y-4">
      <DepartamentoTabs tabs={DEPARTAMENTO_CONFIG.cadastro.tabs} />

      {/* Sub-abas: Checklist Mensal | Gestão de Certidões */}
      <div className="inline-flex rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] p-1">
        {([['checklist', 'Checklist Mensal'], ['gestao', 'Gestão de Certidões']] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setAbaInterna(k)}
            className={`rounded-[var(--radius)] px-3 sm:px-4 py-1.5 text-sm font-semibold transition-colors ${
              abaInterna === k ? 'bg-[var(--brand-soft)] text-[var(--brand-strong)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-3)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {abaInterna === 'gestao' ? (
        <GestaoCertidoes />
      ) : (
      <>
      {/* Cabeçalho */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--brand-soft)] text-[var(--brand-strong)]">
            <ListChecks size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--text-1)]">Checklist Mensal</h1>
            <p className="text-xs text-[var(--text-2)]">Certidões — FGTS, Trabalhista, Estadual, Municipal e Federal</p>
          </div>
        </div>
        {/* Navegação de mês */}
        <div className="flex items-center gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] p-1">
          <button onClick={() => setMes(shiftMonth(mes, -1))} className="rounded-md p-1.5 text-[var(--text-2)] hover:bg-[var(--surface-3)]" aria-label="Mês anterior">
            <ChevronLeft size={18} />
          </button>
          <div className="flex items-center gap-2 px-2 text-sm font-semibold capitalize text-[var(--text-1)]">
            <Calendar size={15} className="text-[var(--text-3)]" />
            {monthLabel(mes)}
          </div>
          <button onClick={() => setMes(shiftMonth(mes, 1))} className="rounded-md p-1.5 text-[var(--text-2)] hover:bg-[var(--surface-3)]" aria-label="Próximo mês">
            <ChevronRight size={18} />
          </button>
          {!isMesAtual && (
            <button onClick={() => setMes(currentMonth())} className="ml-1 rounded-md px-2 py-1 text-xs font-semibold text-[var(--brand-strong)] hover:bg-[var(--brand-soft)]">
              Hoje
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: 'Empresas', valor: linhas.length, cor: 'text-[var(--text-1)]' },
          { label: 'Negativa', valor: stats.negativa, cor: 'text-emerald-600' },
          { label: 'P.E.N.', valor: stats.pen, cor: 'text-amber-600' },
          { label: 'Positiva', valor: stats.positiva, cor: 'text-red-600' },
          { label: 'Falta', valor: stats.falta, cor: 'text-[var(--text-3)]' },
        ].map((s) => (
          <div key={s.label} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <div className="text-xs text-[var(--text-3)]">{s.label}</div>
            <div className={`text-xl font-bold ${s.cor}`}>{s.valor}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por código, razão social, apelido ou CNPJ…"
            className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] py-2.5 pl-9 pr-9 text-sm text-[var(--text-1)] placeholder:text-[var(--text-3)]"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-3)] hover:text-[var(--text-1)]">
              <XCircle size={16} />
            </button>
          )}
        </div>
        <select value={filtroUf} onChange={(e) => setFiltroUf(e.target.value)} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text-1)]">
          <option value="">Todas as UF</option>
          {ufOptions.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
        </select>
        <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as typeof filtroStatus)} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text-1)]">
          <option value="todos">Todos os resultados</option>
          <option value="negativa">Negativa</option>
          <option value="pen">P.E.N.</option>
          <option value="positiva">Positiva</option>
          <option value="falta">Falta</option>
        </select>
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-2)]">
        {(['negativa', 'pen', 'positiva', 'relatorio', 'falta'] as const).map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${CELL_STYLE[c].dot}`} />
            {CELL_STYLE[c].legenda}
          </span>
        ))}
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-10 text-sm text-[var(--text-2)]">
          <Loader2 size={18} className="animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)]" style={{ maxHeight: '72vh' }}>
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 min-w-[220px] border-b border-r border-[var(--border)] bg-[var(--surface-3)] px-3 py-2 text-left text-xs font-semibold text-[var(--text-2)]">
                  Empresa
                </th>
                {CADASTRO_CERTIDAO_COLUNAS.map((coluna) => (
                  <th key={coluna} className="sticky top-0 z-20 min-w-[120px] border-b border-r border-[var(--border)] bg-[var(--surface-3)] px-2 py-2 text-center text-xs font-semibold text-[var(--text-2)]">
                    {CADASTRO_CERTIDAO_LABEL[coluna]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiveis.map((empresa) => (
                <tr key={empresa.id} className="hover:bg-[var(--surface-2)]/40">
                  <td className="sticky left-0 z-10 min-w-[240px] max-w-[280px] border-b border-r border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 align-top">
                    <div className="truncate font-semibold text-[var(--text-1)]">{empresa.apelido || empresa.razao_social || '—'}</div>
                    <div className="text-xs text-[var(--text-3)]">
                      {empresa.codigo}{empresa.estado ? ` · ${ufDaEmpresa(empresa)}` : ''}
                    </div>
                    {empresa.cnpj && <div className="font-mono text-[11px] text-[var(--text-3)]">{formatarDocumento(empresa.cnpj, 'CNPJ')}</div>}
                  </td>
                  {CADASTRO_CERTIDAO_COLUNAS.map((coluna) => {
                    const celulas = celulasDaColuna(coluna, empresa);
                    return (
                      <td key={coluna} className="border-b border-r border-[var(--border)] px-1 py-1 align-middle">
                        <div className={`grid gap-1 ${celulas.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                          {celulas.map((cel) => (
                            <CelulaBtn
                              key={cel.certidao}
                              empresa={empresa}
                              coluna={coluna}
                              cel={cel}
                              item={items.get(buildCadastroKey(empresa.id, cel.certidao))}
                              onClick={() => abrirCelula(empresa, cel.certidao, coluna, cel.subLabel)}
                            />
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {visiveis.length === 0 && (
                <tr>
                  <td colSpan={CADASTRO_CERTIDAO_COLUNAS.length + 1} className="px-3 py-8 text-center text-sm text-[var(--text-3)]">
                    Nenhuma empresa encontrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {linhas.length > paginaTamanho && (
        <div className="flex justify-center">
          <button onClick={() => setPaginaTamanho((p) => p + 50)} className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-semibold text-[var(--text-1)] hover:bg-[var(--surface-3)]">
            Mostrar mais ({linhas.length - paginaTamanho} restantes)
          </button>
        </div>
      )}

      {/* Modal da célula */}
      {target && (
        <CelulaModal
          target={target}
          item={targetItem}
          mes={mes}
          salvando={salvando}
          obsLocal={obsLocal}
          setObsLocal={setObsLocal}
          relatorioLocal={relatorioLocal}
          setRelatorioLocal={setRelatorioLocal}
          precisaMotivo={precisaMotivo}
          motivoReenvio={motivoReenvio}
          setMotivoReenvio={setMotivoReenvio}
          carregandoUrl={carregandoUrl}
          podeApagarHistorico={podeApagarHistorico}
          certDrag={certDrag}
          certDragHandlers={certDragHandlers}
          onClose={fecharCelula}
          onResultado={definirResultado}
          onStatus={definirStatus}
          onSalvarObs={salvarObservacao}
          onSalvarRelatorio={salvarRelatorioTexto}
          onUpload={fazerUpload}
          onRemoverAnexo={removerAnexo}
          onAbrirArquivo={abrirArquivo}
          onEnviar={enviarAoCliente}
          onRemoverEnvio={removerEnvio}
        />
      )}
      </>
      )}
    </div>
  );
}

// ── Botão de célula ───────────────────────────────────────────────────────────
function CelulaBtn({ empresa, coluna, cel, item, onClick }: {
  empresa: Empresa; coluna: CadastroCertidaoColuna; cel: CelulaCertidao;
  item: ChecklistCadastroItem | undefined; onClick: () => void;
}) {
  void empresa; void coluna;
  const cor = corCelulaCadastro(item);
  const cls = CELL_STYLE[cor];
  const resultado = item?.resultado ?? null;
  return (
    <button
      onClick={onClick}
      className={`flex w-full flex-col items-center justify-center rounded-md border px-1 py-1.5 text-[11px] font-semibold transition-colors ${cls.cell}`}
      title={cel.subLabel ? `${CADASTRO_CERTIDAO_LABEL[coluna]} — ${cel.subLabel}` : CADASTRO_CERTIDAO_LABEL[coluna]}
    >
      {cel.subLabel && <span className="text-[9px] font-medium opacity-70">{cel.subLabel}</span>}
      <span>{resultado ? RESULTADO_ABBR[resultado] : '—'}</span>
      <span className="mt-0.5 flex items-center gap-0.5 opacity-80">
        {item?.arquivoUrl && <Paperclip size={10} />}
        {(item?.relatorioUrl || item?.relatorioTexto) && <FileText size={10} />}
        {item?.observacao && <MessageSquare size={10} />}
        {(item?.enviosHistorico?.some((e) => e.sucesso)) && <Check size={10} />}
      </span>
    </button>
  );
}

// ── Modal da célula ───────────────────────────────────────────────────────────
interface CelulaModalProps {
  target: CellTarget;
  item: ChecklistCadastroItem | undefined;
  mes: string;
  salvando: boolean;
  obsLocal: string; setObsLocal: (v: string) => void;
  relatorioLocal: string; setRelatorioLocal: (v: string) => void;
  precisaMotivo: boolean;
  motivoReenvio: string; setMotivoReenvio: (v: string) => void;
  carregandoUrl: boolean;
  podeApagarHistorico: boolean;
  certDrag: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  certDragHandlers: any;
  onClose: () => void;
  onResultado: (r: CadastroResultado | null) => void;
  onStatus: (s: CadastroStatus | null) => void;
  onSalvarObs: () => void;
  onSalvarRelatorio: () => void;
  onUpload: (f: File, slot: 'arquivo' | 'relatorio') => void;
  onRemoverAnexo: (slot: 'arquivo' | 'relatorio') => void;
  onAbrirArquivo: (slot: 'arquivo' | 'relatorio') => void;
  onEnviar: (forcarReenvio: boolean) => void;
  onRemoverEnvio: (envioId: UUID) => void;
}

function CelulaModal(p: CelulaModalProps) {
  const { target, item } = p;
  const fileCertRef = useRef<HTMLInputElement>(null);
  const fileRelRef = useRef<HTMLInputElement>(null);
  const coluna = colunaDaCertidao(target.certidao);
  const opcoesResultado = resultadosPermitidos(coluna);
  const cor = corCelulaCadastro(item);
  const podeEnviar = !!item?.arquivoUrl && certidaoPodeEnviar(coluna, item?.resultado);
  const jaEnviou = item?.enviosHistorico?.some((e) => e.sucesso);
  const titulo = `${CADASTRO_CERTIDAO_LABEL[coluna]}${target.subLabel ? ` — ${target.subLabel}` : ''}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={p.onClose}>
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-[var(--radius-md)] bg-[var(--surface-1)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-5 py-3">
          <div>
            <div className="text-xs text-[var(--text-3)]">{target.empresa.apelido || target.empresa.razao_social}</div>
            <div className="text-base font-bold text-[var(--text-1)]">{titulo}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${CELL_STYLE[cor].cell}`}>
              <span className={`h-2 w-2 rounded-full ${CELL_STYLE[cor].dot}`} />{CELL_STYLE[cor].legenda}
            </span>
            <button onClick={p.onClose} className="rounded-md p-1 text-[var(--text-3)] hover:bg-[var(--surface-3)] hover:text-[var(--text-1)]"><X size={18} /></button>
          </div>
        </div>

        <div className="space-y-4 p-5">
          {/* Resultado */}
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-3)]">Resultado</div>
            <div className="flex flex-wrap gap-2">
              {opcoesResultado.map((r) => {
                const ativo = item?.resultado === r;
                const enviavel = certidaoPodeEnviar(coluna, r);
                return (
                  <button
                    key={r}
                    disabled={p.salvando}
                    onClick={() => p.onResultado(ativo ? null : r)}
                    className={`rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors ${
                      ativo
                        ? (enviavel ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-red-300 bg-red-50 text-red-700')
                        : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--surface-3)]'
                    }`}
                    title={enviavel ? 'Pode ser enviada ao cliente' : 'NÃO é enviada ao cliente'}
                  >
                    {RESULTADO_ABBR[r]} · {r === 'PEN' ? 'Positiva c/ efeito' : r}
                  </button>
                );
              })}
            </div>
            {item?.resultado && !certidaoPodeEnviar(coluna, item.resultado) && (
              <div className="mt-1.5 text-xs text-red-600">Esta certidão não é enviada ao cliente (Positiva{coluna === 'FGTS' || coluna === 'TRABALHISTA' ? ' / P.E.N.' : ''}).</div>
            )}
          </div>

          {/* Status manual (cor) */}
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-3)]">Status (cor) — opcional</div>
            <div className="grid grid-cols-3 gap-2">
              {([['tem', 'Tem certidão'], ['relatorio', 'Relatório'], ['falta', 'Falta']] as const).map(([s, label]) => {
                const ativo = item?.status === s;
                return (
                  <button
                    key={s}
                    disabled={p.salvando}
                    onClick={() => p.onStatus(ativo ? null : s)}
                    className={`rounded-md border px-2 py-1.5 text-xs font-semibold ${ativo ? CELL_STYLE[s].cell : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--surface-3)]'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-3)]">Sem status manual, a cor vem do conteúdo (certidão → verde, relatório → azul, vazio → vermelho).</div>
          </div>

          {/* Certidão (PDF) */}
          <div {...p.certDragHandlers} className={`rounded-md border ${p.certDrag ? 'border-emerald-400 bg-emerald-50/40' : 'border-[var(--border)]'} p-3`}>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-3)]">Certidão (PDF)</div>
              {item?.emissaoEm && <span className="text-[11px] text-[var(--text-3)]">Emitida {formatBR(item.emissaoEm)}</span>}
            </div>
            {item?.arquivoUrl ? (
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-sm text-[var(--text-1)]">
                  <Paperclip size={14} className="shrink-0 text-emerald-600" />
                  <span className="truncate">{item.arquivoNome}</span>
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => p.onAbrirArquivo('arquivo')} disabled={p.carregandoUrl} className="rounded-md p-1.5 text-[var(--text-2)] hover:bg-[var(--surface-3)]" title="Abrir">
                    {p.carregandoUrl ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />}
                  </button>
                  <button onClick={() => p.onRemoverAnexo('arquivo')} disabled={p.salvando} className="rounded-md p-1.5 text-red-500 hover:bg-red-50" title="Remover"><Trash2 size={15} /></button>
                </div>
              </div>
            ) : (
              <button onClick={() => fileCertRef.current?.click()} disabled={p.salvando} className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border)] py-2.5 text-sm text-[var(--text-2)] hover:bg-[var(--surface-3)]">
                <Upload size={15} /> Anexar certidão (ou arraste aqui)
              </button>
            )}
            <input ref={fileCertRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onUpload(f, 'arquivo'); e.target.value = ''; }} />
          </div>

          {/* Relatório */}
          <div className="rounded-md border border-[var(--border)] p-3">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-3)]">Relatório</div>
            {item?.relatorioUrl ? (
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-sm text-[var(--text-1)]">
                  <FileText size={14} className="shrink-0 text-sky-600" />
                  <span className="truncate">{item.relatorioNome}</span>
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => p.onAbrirArquivo('relatorio')} disabled={p.carregandoUrl} className="rounded-md p-1.5 text-[var(--text-2)] hover:bg-[var(--surface-3)]" title="Abrir"><Eye size={15} /></button>
                  <button onClick={() => p.onRemoverAnexo('relatorio')} disabled={p.salvando} className="rounded-md p-1.5 text-red-500 hover:bg-red-50" title="Remover"><Trash2 size={15} /></button>
                </div>
              </div>
            ) : (
              <button onClick={() => fileRelRef.current?.click()} disabled={p.salvando} className="mb-2 flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border)] py-2 text-sm text-[var(--text-2)] hover:bg-[var(--surface-3)]">
                <Upload size={15} /> Anexar relatório
              </button>
            )}
            <input ref={fileRelRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onUpload(f, 'relatorio'); e.target.value = ''; }} />
            <textarea
              value={p.relatorioLocal}
              onChange={(e) => p.setRelatorioLocal(e.target.value)}
              placeholder="Ou registre o relatório como texto…"
              rows={2}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-sm text-[var(--text-1)] placeholder:text-[var(--text-3)]"
            />
            {p.relatorioLocal !== (item?.relatorioTexto ?? '') && (
              <button onClick={p.onSalvarRelatorio} disabled={p.salvando} className="mt-1.5 rounded-md bg-[var(--brand-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-strong)]">Salvar relatório</button>
            )}
          </div>

          {/* Observação */}
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-3)]">Observação</div>
            <textarea
              value={p.obsLocal}
              onChange={(e) => p.setObsLocal(e.target.value)}
              rows={2}
              placeholder="Anotação interna…"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-sm text-[var(--text-1)] placeholder:text-[var(--text-3)]"
            />
            {p.obsLocal !== (item?.observacao ?? '') && (
              <button onClick={p.onSalvarObs} disabled={p.salvando} className="mt-1.5 rounded-md bg-[var(--brand-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-strong)]">Salvar observação</button>
            )}
          </div>

          {/* Envio ao cliente */}
          <div className="rounded-md border border-[var(--border)] p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-3)]">Envio ao cliente</div>
              <span className="text-[11px] text-[var(--text-3)]">e-mail do cadastro</span>
            </div>
            {!podeEnviar ? (
              <div className="text-xs text-[var(--text-3)]">
                {!item?.arquivoUrl ? 'Anexe a certidão (PDF) para habilitar o envio.' : 'Este resultado não é enviado ao cliente.'}
              </div>
            ) : !p.precisaMotivo ? (
              <button onClick={() => p.onEnviar(false)} disabled={p.salvando} className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                {p.salvando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                {jaEnviou ? 'Reenviar certidão' : 'Enviar certidão'}
              </button>
            ) : (
              <div className="space-y-2">
                <div className="text-xs text-amber-700">Já enviada antes — informe o motivo do reenvio (mín. 10 caracteres).</div>
                <textarea value={p.motivoReenvio} onChange={(e) => p.setMotivoReenvio(e.target.value)} rows={2} placeholder="Motivo do reenvio…" className="w-full rounded-md border border-amber-300 bg-amber-50/40 px-2.5 py-2 text-sm text-[var(--text-1)]" />
                <button onClick={() => p.onEnviar(true)} disabled={p.salvando || p.motivoReenvio.trim().length < 10} className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                  {p.salvando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Confirmar reenvio
                </button>
              </div>
            )}

            {/* Histórico de envios */}
            {item?.enviosHistorico && item.enviosHistorico.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-3)]"><History size={12} /> Histórico</div>
                {item.enviosHistorico.map((e) => (
                  <div key={e.id} className="flex items-start justify-between gap-2 text-[11px]">
                    <div className="flex min-w-0 items-start gap-1.5">
                      {e.sucesso ? <MailCheck size={13} className="mt-0.5 shrink-0 text-emerald-600" /> : <MailX size={13} className="mt-0.5 shrink-0 text-red-500" />}
                      <div className="min-w-0">
                        <div className="text-[var(--text-2)]">
                          {formatDateTimeBR(e.enviadoEm)} · {e.destinatarios.join(', ') || '—'}
                          {e.enviadoPorNome ? ` · ${e.enviadoPorNome}` : ''}
                        </div>
                        {e.sucesso && (
                          e.abertoEm
                            ? <div className="inline-flex items-center gap-1 text-emerald-600"><Eye size={11} /> Visualizado {formatDateTimeBR(e.abertoEm)}{typeof e.aberturas === 'number' && e.aberturas > 1 ? ` (${e.aberturas}×)` : ''}</div>
                            : <div className="text-[var(--text-3)]">Não visualizado ainda</div>
                        )}
                        {e.motivoReenvio && <div className="text-amber-700">Reenvio: {e.motivoReenvio}</div>}
                        {!e.sucesso && e.erro && <div className="text-red-500">{e.erro}</div>}
                      </div>
                    </div>
                    {p.podeApagarHistorico && (
                      <button onClick={() => p.onRemoverEnvio(e.id)} className="shrink-0 text-[var(--text-3)] hover:text-red-500" title="Apagar"><Trash2 size={12} /></button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
