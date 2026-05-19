'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Building2, Calendar, CheckCircle2, FileText, Loader2, Search, Send, Settings, Shield,
  ShieldAlert, Upload, XCircle, ArrowLeft, ToggleLeft, ToggleRight,
} from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import { garantirVencimentosFiscaisComRegras } from '@/app/utils/vencimentos';
import { extrairTextoPdf } from '@/app/utils/extrairTextoPdf';
import { validarGuia, type ResultadoValidacao } from '@/app/utils/validarGuia';
import {
  fetchChecklistFiscalByMes,
  fetchEmpresaEmailsCliente,
  fetchEmpresaObrigacoesConfig,
  upsertChecklistFiscal,
  upsertEmpresaObrigacaoConfig,
  uploadChecklistArquivo,
} from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { formatBR } from '@/app/utils/date';
import ModalBase from '@/app/components/ModalBase';
import FiscalTabs from '@/app/vencimentos-fiscais/FiscalTabs';
import type {
  ChecklistFiscalItem, Empresa, EmpresaEmailCliente, EmpresaObrigacaoConfig, UUID, VencimentoFiscal,
} from '@/app/types';

function mesAtualKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatComp(iso: string): string {
  const [y, m] = iso.split('-');
  if (!y || !m) return iso;
  const meses = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${meses[Number(m)]}/${y}`;
}

function formatBRL(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function competenciaOpcoes(): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    const dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

type StatusEnvio = 'pendente' | 'enviada';

interface ObrigacaoLinha {
  fiscal: VencimentoFiscal;
  status: StatusEnvio;
  checklistItem: ChecklistFiscalItem | null;
  naoEnviaCliente: boolean;
}

export default function EnvioGuiasPage() {
  const { empresas, departamentos, currentUser, canManage, isPrivileged, authReady, mostrarAlerta } = useSistema();

  const [mes, setMes] = useState<string>(mesAtualKey());
  const [search, setSearch] = useState('');
  const [empresaSelecionadaId, setEmpresaSelecionadaId] = useState<UUID | null>(null);

  const [checklistDoMes, setChecklistDoMes] = useState<ChecklistFiscalItem[]>([]);
  const [carregandoChecklist, setCarregandoChecklist] = useState(false);

  // Mapa: empresaId -> lista de configs (ativa + codigos esperados + motivo) por obrigação
  const [configsPorEmpresa, setConfigsPorEmpresa] = useState<Map<UUID, EmpresaObrigacaoConfig[]>>(new Map());

  const [modalEnvio, setModalEnvio] = useState<{ empresa: Empresa; fiscal: VencimentoFiscal } | null>(null);
  const [modalConfig, setModalConfig] = useState<Empresa | null>(null);

  // Departamento fiscal — usado pra filtrar empresas onde o usuário comum é responsável.
  const fiscalDeptIds = useMemo(() => {
    const ids = new Set<UUID>();
    for (const d of departamentos) {
      const n = d.nome.toLowerCase();
      if (n.includes('fiscal')) ids.add(d.id);
    }
    return ids;
  }, [departamentos]);

  // Empresas visíveis: usuário comum vê só as que é responsável fiscal; gerente/admin vê todas (não desligadas).
  const empresasVisiveis = useMemo(() => {
    return empresas.filter((e) => {
      if (e.desligada_em) return false;
      if (canManage || isPrivileged) return true;
      if (!currentUser) return false;
      // É responsável fiscal de alguma das deptos fiscais?
      for (const deptId of fiscalDeptIds) {
        if (e.responsaveis?.[deptId] === currentUser.id) return true;
      }
      return false;
    });
  }, [empresas, canManage, isPrivileged, currentUser, fiscalDeptIds]);

  // Recarrega o checklist do mês quando muda o mês ou após envio
  const recarregarChecklist = React.useCallback(() => {
    setCarregandoChecklist(true);
    fetchChecklistFiscalByMes(mes)
      .then((lista) => setChecklistDoMes(lista))
      .catch(() => setChecklistDoMes([]))
      .finally(() => setCarregandoChecklist(false));
  }, [mes]);

  useEffect(() => {
    if (!authReady) return;
    recarregarChecklist();
  }, [authReady, recarregarChecklist]);

  // Mapa: "empresaId|obrigacao" -> ChecklistFiscalItem
  const checklistMap = useMemo(() => {
    const m = new Map<string, ChecklistFiscalItem>();
    for (const it of checklistDoMes) {
      m.set(`${it.empresaId}|${it.obrigacao}`, it);
    }
    return m;
  }, [checklistDoMes]);

  // Linhas: empresas filtradas pela busca + contagem pendentes
  const linhas = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = empresasVisiveis
      .filter((e) => {
        if (!q) return true;
        const hay = `${e.codigo} ${e.razao_social ?? ''} ${e.apelido ?? ''} ${e.cnpj ?? ''}`.toLowerCase();
        return hay.includes(q);
      })
      .map((empresa) => {
        const fiscais = garantirVencimentosFiscaisComRegras(empresa.vencimentosFiscais, empresa.estado, empresa.cidade);
        let pendentes = 0;
        let enviadas = 0;
        for (const f of fiscais) {
          const key = `${empresa.id}|${f.nome}`;
          const it = checklistMap.get(key);
          if (it?.concluido) enviadas++;
          else pendentes++;
        }
        return { empresa, total: fiscais.length, pendentes, enviadas };
      })
      .sort((a, b) => {
        // ordena: empresas com pendentes primeiro, depois alfabético por código
        if (a.pendentes !== b.pendentes) return b.pendentes - a.pendentes;
        return a.empresa.codigo.localeCompare(b.empresa.codigo);
      });
    return out;
  }, [empresasVisiveis, search, checklistMap]);

  const empresaSelecionada = useMemo(() => {
    if (!empresaSelecionadaId) return null;
    return empresasVisiveis.find((e) => e.id === empresaSelecionadaId) ?? null;
  }, [empresasVisiveis, empresaSelecionadaId]);

  const carregarConfigEmpresa = React.useCallback((empresaId: UUID) => {
    fetchEmpresaObrigacoesConfig(empresaId)
      .then((lista) => {
        setConfigsPorEmpresa((prev) => {
          const next = new Map(prev);
          next.set(empresaId, lista);
          return next;
        });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!empresaSelecionada) return;
    carregarConfigEmpresa(empresaSelecionada.id);
  }, [empresaSelecionada, carregarConfigEmpresa]);

  function configDeObrigacao(empresaId: UUID, obrigacao: string): EmpresaObrigacaoConfig | null {
    const lista = configsPorEmpresa.get(empresaId);
    if (!lista) return null;
    return lista.find((c) => c.obrigacao === obrigacao) ?? null;
  }

  // Obrigações da empresa selecionada para o mês escolhido (já filtra desativadas)
  const obrigacoesEmpresa: ObrigacaoLinha[] = useMemo(() => {
    if (!empresaSelecionada) return [];
    const fiscais = garantirVencimentosFiscaisComRegras(
      empresaSelecionada.vencimentosFiscais,
      empresaSelecionada.estado,
      empresaSelecionada.cidade,
    );
    const configs = configsPorEmpresa.get(empresaSelecionada.id) ?? [];
    const configPorNome = new Map(configs.map((c) => [c.obrigacao, c]));
    const desativadas = new Set(configs.filter((c) => !c.ativa).map((c) => c.obrigacao));
    return fiscais
      .filter((f) => !desativadas.has(f.nome))
      .map((fiscal) => {
        const it = checklistMap.get(`${empresaSelecionada.id}|${fiscal.nome}`);
        const status: StatusEnvio = it?.concluido ? 'enviada' : 'pendente';
        const cfg = configPorNome.get(fiscal.nome);
        return { fiscal, status, checklistItem: it ?? null, naoEnviaCliente: cfg?.naoEnviaCliente ?? false };
      })
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'pendente' ? -1 : 1;
        return a.fiscal.nome.localeCompare(b.fiscal.nome);
      });
  }, [empresaSelecionada, checklistMap, configsPorEmpresa]);

  if (!authReady) return null;

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 max-w-full">
      <FiscalTabs />

      {/* Header */}
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-500 flex items-center justify-center shadow-md shrink-0">
            <Send className="text-white" size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-lg sm:text-2xl font-bold text-gray-900">Envio de Guias</div>
            <div className="text-xs sm:text-sm text-gray-500">
              Selecione a empresa, escolha a guia e envie. O sistema valida o PDF antes do envio e marca como feito automaticamente no checklist.
            </div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm border border-gray-100">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar empresa, código, CNPJ..."
              className="w-full rounded-xl bg-gray-50 pl-10 pr-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-violet-400 focus:bg-white transition"
            />
          </div>
          <select
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-violet-400"
          >
            {competenciaOpcoes().map((c) => (
              <option key={c} value={c}>Competência: {formatComp(c)}</option>
            ))}
          </select>
          <div className="flex items-center justify-end gap-2 text-xs text-gray-500">
            {carregandoChecklist ? (
              <><Loader2 className="animate-spin" size={14} /> carregando…</>
            ) : (
              <>{linhas.length} empresa{linhas.length === 1 ? '' : 's'} visível{linhas.length === 1 ? '' : 'eis'}</>
            )}
          </div>
        </div>
      </div>

      {/* Layout 2 colunas */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-3 sm:gap-4">
        {/* Lista de empresas */}
        <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden flex flex-col max-h-[calc(100vh-280px)]">
          <div className="px-3 py-2 bg-gray-50 border-b text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
            <Building2 size={12} /> Empresas
          </div>
          <div className="overflow-y-auto">
            {linhas.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-500">
                <Shield className="mx-auto mb-2 text-gray-300" size={28} />
                {empresasVisiveis.length === 0
                  ? 'Você não é responsável fiscal por nenhuma empresa.'
                  : 'Nenhuma empresa encontrada com esses filtros.'}
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {linhas.map(({ empresa, pendentes, enviadas, total }) => {
                  const ativa = empresaSelecionadaId === empresa.id;
                  const tudoFeito = pendentes === 0 && total > 0;
                  return (
                    <li key={empresa.id}>
                      <button
                        onClick={() => setEmpresaSelecionadaId(empresa.id)}
                        className={`w-full text-left px-3 py-2.5 transition flex items-center gap-2 ${
                          ativa ? 'bg-violet-50 border-l-4 border-violet-500' : 'hover:bg-gray-50 border-l-4 border-transparent'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-gray-900 truncate">{empresa.codigo}</div>
                          <div className="text-[11px] text-gray-500 truncate">
                            {empresa.apelido || empresa.razao_social || '(sem nome)'}
                          </div>
                        </div>
                        {total > 0 && (
                          <div className="flex flex-col items-end gap-0.5 shrink-0">
                            {tudoFeito ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 rounded-full px-1.5 py-0.5">
                                <CheckCircle2 size={10} /> tudo feito
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-1.5 py-0.5">
                                {pendentes} pend.
                              </span>
                            )}
                            <span className="text-[9px] text-gray-400">{enviadas}/{total}</span>
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Painel direito: obrigações da empresa selecionada */}
        <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
          {!empresaSelecionada ? (
            <div className="p-10 text-center text-gray-500">
              <ArrowLeft className="mx-auto mb-3 text-gray-300" size={32} />
              <div className="font-bold text-gray-700 mb-1">Selecione uma empresa à esquerda</div>
              <div className="text-xs">As obrigações fiscais dela do mês aparecerão aqui.</div>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white flex items-center gap-3">
                <Building2 size={18} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold opacity-90 uppercase tracking-wider truncate">
                    {empresaSelecionada.codigo} · {empresaSelecionada.cnpj ?? 'sem CNPJ'}
                  </div>
                  <div className="text-sm font-bold truncate">
                    {empresaSelecionada.razao_social || empresaSelecionada.apelido || '(sem nome)'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {(canManage || isPrivileged) && (
                    <button
                      onClick={() => setModalConfig(empresaSelecionada)}
                      className="inline-flex items-center gap-1 rounded-lg bg-white/20 hover:bg-white/30 px-2.5 py-1 text-[11px] font-bold transition"
                      title="Ativar/desativar obrigações desta empresa"
                    >
                      <Settings size={12} />
                      Configurar
                    </button>
                  )}
                  <div className="text-[10px] opacity-80">{formatComp(mes)}</div>
                </div>
              </div>

              {obrigacoesEmpresa.length === 0 ? (
                <div className="p-10 text-center text-gray-500 text-sm">
                  Esta empresa não tem obrigações fiscais cadastradas.
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {obrigacoesEmpresa.map(({ fiscal, status, checklistItem, naoEnviaCliente }) => {
                    const enviada = status === 'enviada';
                    return (
                      <li key={fiscal.id} className="p-3 sm:p-4 flex items-center gap-3 flex-wrap">
                        <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
                          enviada ? 'bg-emerald-100 text-emerald-700'
                          : naoEnviaCliente ? 'bg-slate-100 text-slate-600'
                          : 'bg-amber-100 text-amber-700'
                        }`}>
                          {enviada ? <CheckCircle2 size={18} /> : <FileText size={16} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-gray-900 flex items-center gap-2 flex-wrap">
                            {fiscal.nome}
                            {naoEnviaCliente && (
                              <span className="text-[9px] font-bold uppercase tracking-wider bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
                                Interna
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-500 flex items-center gap-2 flex-wrap">
                            {fiscal.vencimento && (
                              <span className="inline-flex items-center gap-1">
                                <Calendar size={10} /> vence {formatBR(fiscal.vencimento)}
                              </span>
                            )}
                            {naoEnviaCliente && (
                              <span className="text-slate-500 italic">não envia ao cliente</span>
                            )}
                            {enviada && checklistItem?.concluidoEm && (
                              <span className="text-emerald-700 font-semibold">
                                {naoEnviaCliente ? 'concluída' : 'enviada'} em {formatBR(checklistItem.concluidoEm.split('T')[0])}
                                {checklistItem.concluidoPorNome ? ` por ${checklistItem.concluidoPorNome}` : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => setModalEnvio({ empresa: empresaSelecionada, fiscal })}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition shrink-0 ${
                            enviada
                              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              : naoEnviaCliente
                              ? 'bg-slate-700 text-white shadow-sm hover:bg-slate-800'
                              : 'bg-gradient-to-r from-violet-500 to-fuchsia-600 text-white shadow-sm hover:from-violet-600 hover:to-fuchsia-700'
                          }`}
                        >
                          {enviada ? (
                            <><Upload size={12} /> Reenviar</>
                          ) : naoEnviaCliente ? (
                            <><CheckCircle2 size={12} /> Marcar feito</>
                          ) : (
                            <><Send size={12} /> Enviar guia</>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      {modalEnvio && (
        <ModalEnviarGuia
          empresa={modalEnvio.empresa}
          fiscal={modalEnvio.fiscal}
          mes={mes}
          codigosEsperados={configDeObrigacao(modalEnvio.empresa.id, modalEnvio.fiscal.nome)?.codigos ?? []}
          naoEnviaCliente={configDeObrigacao(modalEnvio.empresa.id, modalEnvio.fiscal.nome)?.naoEnviaCliente ?? false}
          podeForcar={canManage || isPrivileged}
          currentUserNome={currentUser?.nome ?? null}
          onClose={() => setModalEnvio(null)}
          onEnviado={() => {
            setModalEnvio(null);
            recarregarChecklist();
            mostrarAlerta('Guia enviada', 'Email enviado e checklist marcado como feito.', 'sucesso');
          }}
          onErro={(msg) => mostrarAlerta('Erro', msg, 'erro')}
        />
      )}

      {modalConfig && (
        <ModalConfigurarObrigacoes
          empresa={modalConfig}
          currentUserId={currentUser?.id ?? null}
          currentUserNome={currentUser?.nome ?? null}
          onClose={() => setModalConfig(null)}
          onSalvo={() => {
            carregarConfigEmpresa(modalConfig.id);
            setModalConfig(null);
            mostrarAlerta('Configuração salva', 'As obrigações desta empresa foram atualizadas.', 'sucesso');
          }}
          onErro={(msg) => mostrarAlerta('Erro', msg, 'erro')}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Modal de envio: upload + validação + preview + envio
// ──────────────────────────────────────────────────────────────────────────

interface ModalEnviarGuiaProps {
  empresa: Empresa;
  fiscal: VencimentoFiscal;
  mes: string;
  codigosEsperados: string[];
  naoEnviaCliente: boolean;
  podeForcar: boolean;
  currentUserNome: string | null;
  onClose: () => void;
  onEnviado: () => void;
  onErro: (msg: string) => void;
}

function ModalEnviarGuia({
  empresa, fiscal, mes, codigosEsperados, naoEnviaCliente, podeForcar, currentUserNome, onClose, onEnviado, onErro,
}: ModalEnviarGuiaProps) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoValidacao | null>(null);
  const [emails, setEmails] = useState<EmpresaEmailCliente[]>([]);
  const [carregandoEmails, setCarregandoEmails] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [motivoForcar, setMotivoForcar] = useState('');

  useEffect(() => {
    if (naoEnviaCliente) {
      setCarregandoEmails(false);
      setEmails([]);
      return;
    }
    setCarregandoEmails(true);
    fetchEmpresaEmailsCliente(empresa.id)
      .then((lista) => setEmails(lista.filter((e) => e.ativo)))
      .catch(() => setEmails([]))
      .finally(() => setCarregandoEmails(false));
  }, [empresa.id, naoEnviaCliente]);

  async function analisar(file: File) {
    setAnalisando(true);
    setResultado(null);
    try {
      const { texto } = await extrairTextoPdf(file);
      const r = validarGuia(texto, empresa, fiscal.nome, codigosEsperados);
      setResultado(r);
    } catch (err) {
      console.error('[ModalEnviarGuia] falha ao extrair texto:', err);
      onErro('Não foi possível ler este PDF. Pode ser uma imagem scanneada ou um PDF protegido.');
    } finally {
      setAnalisando(false);
    }
  }

  function escolherArquivo(f: File) {
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      onErro('Por enquanto só aceitamos PDF.');
      return;
    }
    setArquivo(f);
    setMotivoForcar('');
    void analisar(f);
  }

  const bloqueios = resultado?.problemas.filter((p) => p.severidade === 'bloqueio') ?? [];
  const avisos = resultado?.problemas.filter((p) => p.severidade === 'aviso') ?? [];
  const valido = resultado?.valido ?? false;
  const precisaForcar = !valido && bloqueios.length > 0;

  const podeEnviar =
    !!arquivo &&
    !!resultado &&
    (naoEnviaCliente || emails.length > 0) &&
    !enviando &&
    !analisando &&
    (valido || (precisaForcar && podeForcar && motivoForcar.trim().length >= 10));

  async function enviar() {
    if (!arquivo || !resultado) return;
    setEnviando(true);
    try {
      // 1. Upload via uploadChecklistArquivo (já marca o registro no checklist_fiscal com arquivo_url)
      const { arquivoUrl } = await uploadChecklistArquivo(
        empresa.id,
        mes,
        fiscal.nome,
        arquivo,
        { autorId: null, autorNome: currentUserNome ?? undefined },
      );

      const obsForcar = precisaForcar
        ? `[ENVIO FORÇADO por ${currentUserNome ?? 'admin'}] ${motivoForcar.trim()}`
        : undefined;

      if (naoEnviaCliente) {
        // Obrigação interna: só upload + marca feito, sem Gmail/portal
        await upsertChecklistFiscal({
          empresaId: empresa.id,
          mes,
          obrigacao: fiscal.nome,
          status: 'feito',
          concluidoPorNome: currentUserNome ?? undefined,
          observacao: obsForcar ?? '[INTERNA] arquivo armazenado para controle do escritório',
        });
        onEnviado();
        return;
      }

      // Fluxo normal: envia email via API
      const { data: row } = await supabase
        .from('checklist_fiscal')
        .select('id')
        .eq('empresa_id', empresa.id)
        .eq('mes', mes)
        .eq('obrigacao', fiscal.nome)
        .maybeSingle();
      const checklistId = (row as { id?: string } | null)?.id;

      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;
      if (!token) throw new Error('Sessão expirada. Faça login novamente.');

      const resp = await fetch('/api/checklist-fiscal/enviar-anexo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          empresaId: empresa.id,
          mes,
          obrigacao: fiscal.nome,
          arquivoPath: arquivoUrl,
          arquivoNome: arquivo.name,
          checklistId: checklistId ?? undefined,
        }),
      });
      if (!resp.ok) {
        const erro = await resp.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(erro.error || `Falha no envio (HTTP ${resp.status})`);
      }

      await upsertChecklistFiscal({
        empresaId: empresa.id,
        mes,
        obrigacao: fiscal.nome,
        status: 'feito',
        concluidoPorNome: currentUserNome ?? undefined,
        observacao: obsForcar,
      });

      onEnviado();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro inesperado no envio.';
      onErro(msg);
    } finally {
      setEnviando(false);
    }
  }

  const competenciaDivergente =
    resultado?.detectado.competencia && resultado.detectado.competencia !== mes;

  return (
    <ModalBase isOpen={true} onClose={enviando ? () => undefined : onClose} dialogClassName="max-w-2xl">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold opacity-90 uppercase tracking-wider">Enviar guia</div>
            <div className="text-lg font-bold truncate">{fiscal.nome}</div>
            <div className="text-xs opacity-90 truncate">
              {empresa.razao_social || empresa.apelido} · {empresa.cnpj} · {formatComp(mes)}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={enviando}
            className="rounded-lg p-1.5 bg-white/20 hover:bg-white/30 text-white transition disabled:opacity-50"
            aria-label="Fechar"
          >
            <XCircle size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {naoEnviaCliente ? (
            <div className="rounded-lg bg-slate-100 border border-slate-300 p-3 text-xs text-slate-700">
              <strong>Obrigação interna do escritório.</strong> O arquivo será apenas armazenado para controle (não envia email ao cliente).
            </div>
          ) : carregandoEmails ? (
            <div className="text-xs text-gray-500 flex items-center gap-1.5">
              <Loader2 className="animate-spin" size={12} /> Carregando emails…
            </div>
          ) : emails.length === 0 ? (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-800">
              <strong>Empresa sem emails cadastrados.</strong> Cadastre pelo menos um email do cliente em Empresas antes de enviar.
            </div>
          ) : (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900">
              <strong>Destinatários:</strong> {emails.map((e) => e.email).join(', ')}
            </div>
          )}

          {/* Upload */}
          {!arquivo ? (
            <label className="block rounded-xl border-2 border-dashed border-violet-300 bg-violet-50/50 p-8 text-center cursor-pointer hover:bg-violet-50 transition">
              <Upload className="mx-auto mb-2 text-violet-500" size={32} />
              <div className="text-sm font-bold text-violet-700">Escolher PDF da guia</div>
              <div className="text-xs text-violet-600 mt-1">Clique para selecionar o arquivo</div>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) escolherArquivo(f);
                  e.target.value = '';
                }}
              />
            </label>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 flex items-center gap-3">
              <FileText className="text-violet-500 shrink-0" size={20} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-gray-900 truncate">{arquivo.name}</div>
                <div className="text-[11px] text-gray-500">
                  {(arquivo.size / 1024).toFixed(0)} KB
                </div>
              </div>
              <button
                onClick={() => { setArquivo(null); setResultado(null); setMotivoForcar(''); }}
                disabled={enviando}
                className="text-xs text-gray-500 hover:text-red-600 font-bold"
              >
                Trocar
              </button>
            </div>
          )}

          {/* Análise */}
          {analisando && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm text-gray-600 flex items-center gap-2">
              <Loader2 className="animate-spin" size={16} /> Analisando PDF…
            </div>
          )}

          {/* Bloqueios */}
          {resultado && bloqueios.length > 0 && (
            <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 space-y-3">
              <div className="flex items-center gap-2 text-red-800 font-bold">
                <ShieldAlert size={20} className="text-red-600" />
                <span className="text-base">Esta guia não confere</span>
              </div>
              <ul className="space-y-2 text-sm text-red-900">
                {bloqueios.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-red-600 font-bold">•</span>
                    <div>
                      <strong>{p.motivo}.</strong> {p.detalhe}
                    </div>
                  </li>
                ))}
              </ul>
              {podeForcar ? (
                <div className="mt-3 border-t border-red-200 pt-3">
                  <div className="text-xs font-bold text-red-900 mb-1">Forçar envio (admin/gerente)</div>
                  <p className="text-[11px] text-red-700 mb-2">
                    Se você tem certeza que a guia está correta, descreva o motivo (mínimo 10 caracteres). Isto fica registrado no log.
                  </p>
                  <textarea
                    value={motivoForcar}
                    onChange={(e) => setMotivoForcar(e.target.value)}
                    placeholder="Ex: PDF foi reemitido sem o CNPJ no cabeçalho, mas é da empresa correta — conferi manualmente."
                    className="w-full text-xs rounded-lg border border-red-300 bg-white p-2 focus:ring-2 focus:ring-red-400 outline-none"
                    rows={2}
                  />
                </div>
              ) : (
                <div className="mt-3 text-xs text-red-700 italic border-t border-red-200 pt-3">
                  Só gerente ou admin pode forçar o envio neste caso. Suba o PDF correto ou peça a um responsável.
                </div>
              )}
            </div>
          )}

          {/* Avisos */}
          {resultado && avisos.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
              <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
                <AlertTriangle size={16} />
                Avisos
              </div>
              <ul className="space-y-1 text-xs text-amber-900">
                {avisos.map((p, i) => (
                  <li key={i}>
                    <strong>{p.motivo}.</strong> {p.detalhe}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Preview detectado */}
          {resultado && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-1.5 text-xs">
              <div className="font-bold text-gray-700 mb-1">Detectado no PDF:</div>
              <div className="grid grid-cols-2 gap-2">
                <PreviewLine label="Perfil" valor={resultado.perfilUsado ?? '(sem perfil)'} />
                <PreviewLine label="CNPJ" valor={resultado.detectado.cnpjEncontrado ? formatarCnpj(resultado.detectado.cnpjEncontrado) : null} bom={!!resultado.detectado.cnpjEncontrado} />
                <PreviewLine label="Denominação" valor={resultado.detectado.denominacaoEncontrada} bom={!!resultado.detectado.denominacaoEncontrada} />
                <PreviewLine label="Código receita" valor={resultado.detectado.codigoReceitaEncontrado} />
                <PreviewLine label="Cidade" valor={resultado.detectado.cidadeEncontrada} />
                <PreviewLine
                  label="Competência"
                  valor={resultado.detectado.competencia ? formatComp(resultado.detectado.competencia) : null}
                  alerta={competenciaDivergente
                    ? `mês selecionado (${formatComp(mes)}) é diferente do detectado no PDF`
                    : undefined}
                />
                <PreviewLine label="Vencimento" valor={resultado.detectado.vencimento ? formatBR(resultado.detectado.vencimento) : null} />
                <PreviewLine label="Valor" valor={resultado.detectado.valor != null ? formatBRL(resultado.detectado.valor) : null} />
              </div>
            </div>
          )}

          {/* Sucesso */}
          {resultado && valido && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-900 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
              <span><strong>Guia validada.</strong> Tudo confere — pode enviar.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={enviando}
            className="rounded-lg px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-200 transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={enviar}
            disabled={!podeEnviar}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {enviando ? (
              <><Loader2 className="animate-spin" size={14} /> {naoEnviaCliente ? 'Salvando…' : 'Enviando…'}</>
            ) : precisaForcar ? (
              <><ShieldAlert size={14} /> {naoEnviaCliente ? 'Forçar marcação' : 'Forçar envio'}</>
            ) : naoEnviaCliente ? (
              <><CheckCircle2 size={14} /> Marcar feito</>
            ) : (
              <><Send size={14} /> Enviar e marcar feito</>
            )}
          </button>
        </div>
      </div>
    </ModalBase>
  );
}

function PreviewLine({
  label, valor, bom, alerta,
}: { label: string; valor: string | null; bom?: boolean; alerta?: string }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-xs font-semibold truncate ${
        alerta ? 'text-amber-700' : bom === false ? 'text-red-600' : valor ? 'text-gray-900' : 'text-gray-400'
      }`}>
        {valor || '—'}
      </div>
      {alerta && <div className="text-[10px] text-amber-600 italic">{alerta}</div>}
    </div>
  );
}

function formatarCnpj(s: string): string {
  if (s.length !== 14) return s;
  return `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Modal de configuração: ativa/desativa obrigações por empresa
// ──────────────────────────────────────────────────────────────────────────

interface ModalConfigurarObrigacoesProps {
  empresa: Empresa;
  currentUserId: UUID | null;
  currentUserNome: string | null;
  onClose: () => void;
  onSalvo: () => void;
  onErro: (msg: string) => void;
}

interface PendingState { ativa: boolean; motivo: string; codigos: string[]; naoEnviaCliente: boolean }

function ModalConfigurarObrigacoes({
  empresa, currentUserId, currentUserNome, onClose, onSalvo, onErro,
}: ModalConfigurarObrigacoesProps) {
  const [configs, setConfigs] = useState<EmpresaObrigacaoConfig[]>([]);
  const [pendentes, setPendentes] = useState<Map<string, PendingState>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // Todas as obrigações disponíveis pra empresa (baseado nas regras)
  const obrigacoesDisponiveis = useMemo(() => {
    return garantirVencimentosFiscaisComRegras(empresa.vencimentosFiscais, empresa.estado, empresa.cidade)
      .map((f) => f.nome);
  }, [empresa]);

  useEffect(() => {
    setCarregando(true);
    fetchEmpresaObrigacoesConfig(empresa.id)
      .then((lista) => setConfigs(lista))
      .catch(() => setConfigs([]))
      .finally(() => setCarregando(false));
  }, [empresa.id]);

  function estadoAtual(obrigacao: string): PendingState {
    const pendente = pendentes.get(obrigacao);
    if (pendente) return pendente;
    const config = configs.find((c) => c.obrigacao === obrigacao);
    return {
      ativa: config ? config.ativa : true,
      motivo: config?.motivo ?? '',
      codigos: config?.codigos ?? [],
      naoEnviaCliente: config?.naoEnviaCliente ?? false,
    };
  }

  function atualizarPendente(obrigacao: string, patch: Partial<PendingState>) {
    const atual = estadoAtual(obrigacao);
    setPendentes((prev) => {
      const next = new Map(prev);
      next.set(obrigacao, { ...atual, ...patch });
      return next;
    });
  }

  async function salvar() {
    if (pendentes.size === 0) {
      onClose();
      return;
    }
    setSalvando(true);
    try {
      for (const [obrigacao, estado] of pendentes) {
        await upsertEmpresaObrigacaoConfig({
          empresaId: empresa.id,
          obrigacao,
          ativa: estado.ativa,
          motivo: estado.motivo,
          codigos: estado.codigos,
          naoEnviaCliente: estado.naoEnviaCliente,
          currentUserId,
          currentUserNome: currentUserNome ?? undefined,
        });
      }
      onSalvo();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao salvar configuração.';
      onErro(msg);
    } finally {
      setSalvando(false);
    }
  }

  const totalAtivas = obrigacoesDisponiveis.filter((o) => estadoAtual(o).ativa).length;
  const totalDesativadas = obrigacoesDisponiveis.length - totalAtivas;

  return (
    <ModalBase isOpen={true} onClose={salvando ? () => undefined : onClose} dialogClassName="max-w-2xl">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="px-5 py-4 bg-gradient-to-r from-slate-700 to-slate-900 text-white flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold opacity-90 uppercase tracking-wider">Configurar obrigações</div>
            <div className="text-lg font-bold truncate">{empresa.codigo} · {empresa.razao_social || empresa.apelido}</div>
            <div className="text-xs opacity-80">
              {totalAtivas} ativa{totalAtivas === 1 ? '' : 's'} · {totalDesativadas} desativada{totalDesativadas === 1 ? '' : 's'}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={salvando}
            className="rounded-lg p-1.5 bg-white/20 hover:bg-white/30 transition disabled:opacity-50"
            aria-label="Fechar"
          >
            <XCircle size={20} />
          </button>
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900 mb-4">
            <strong>Como funciona:</strong> desligue as obrigações que esta empresa NÃO tem (ex: empresa só de serviços não tem IPI).
            Obrigações desligadas somem da aba <em>Envio de Guias</em>. Você pode reativar a qualquer momento.
          </div>

          {carregando ? (
            <div className="text-sm text-gray-500 flex items-center gap-2 py-4">
              <Loader2 className="animate-spin" size={14} /> Carregando configuração…
            </div>
          ) : obrigacoesDisponiveis.length === 0 ? (
            <div className="text-sm text-gray-500 py-4 text-center">
              Esta empresa não tem obrigações cadastradas.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {obrigacoesDisponiveis.map((obrigacao) => {
                const estado = estadoAtual(obrigacao);
                const tinhaPendencia = pendentes.has(obrigacao);
                const codigosStr = estado.codigos.join(', ');
                return (
                  <li key={obrigacao} className="p-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => atualizarPendente(obrigacao, { ativa: !estado.ativa })}
                        disabled={salvando}
                        className="shrink-0"
                        aria-label={estado.ativa ? 'Desativar' : 'Ativar'}
                      >
                        {estado.ativa ? (
                          <ToggleRight className="text-emerald-600" size={32} />
                        ) : (
                          <ToggleLeft className="text-gray-400" size={32} />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm font-bold ${estado.ativa ? 'text-gray-900' : 'text-gray-500 line-through'}`}>
                          {obrigacao}
                        </div>
                        {tinhaPendencia && (
                          <div className="text-[10px] text-violet-600 font-bold uppercase tracking-wide">
                            Alteração não salva
                          </div>
                        )}
                      </div>
                    </div>
                    {!estado.ativa && (
                      <div className="mt-2 ml-11">
                        <input
                          type="text"
                          value={estado.motivo}
                          onChange={(e) => atualizarPendente(obrigacao, { motivo: e.target.value })}
                          placeholder="Motivo (opcional, ex: empresa só de serviços)"
                          disabled={salvando}
                          className="w-full text-xs rounded-md border border-gray-300 px-2 py-1 focus:ring-2 focus:ring-violet-400 outline-none"
                        />
                      </div>
                    )}
                    {estado.ativa && (
                      <div className="mt-2 ml-11 space-y-2">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-wide mb-1">
                            Códigos de receita esperados (separados por vírgula)
                          </label>
                          <input
                            type="text"
                            value={codigosStr}
                            onChange={(e) => {
                              const codigos = e.target.value
                                .split(',')
                                .map((c) => c.trim())
                                .filter(Boolean);
                              atualizarPendente(obrigacao, { codigos });
                            }}
                            placeholder="ex: 0120-6, 0121-4  (deixe vazio se não quiser validar por código)"
                            disabled={salvando}
                            className="w-full text-xs font-mono rounded-md border border-gray-300 px-2 py-1 focus:ring-2 focus:ring-violet-400 outline-none"
                          />
                          {estado.codigos.length > 0 && (
                            <div className="mt-1 text-[10px] text-gray-500">
                              {estado.codigos.length} código{estado.codigos.length === 1 ? '' : 's'} · validador bloqueia se o PDF trouxer outro
                            </div>
                          )}
                        </div>
                        <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={estado.naoEnviaCliente}
                            onChange={(e) => atualizarPendente(obrigacao, { naoEnviaCliente: e.target.checked })}
                            disabled={salvando}
                            className="rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                          />
                          <span><strong>Não envia ao cliente</strong> — obrigação interna do escritório (ex: SPED, REINF, Livros)</span>
                        </label>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between gap-2">
          <div className="text-xs text-gray-500">
            {pendentes.size > 0 ? `${pendentes.size} altera${pendentes.size === 1 ? 'ção' : 'ções'} pendente${pendentes.size === 1 ? '' : 's'}` : 'Nenhuma alteração'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={salvando}
              className="rounded-lg px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-200 transition disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={salvar}
              disabled={salvando || pendentes.size === 0}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white bg-gradient-to-r from-slate-700 to-slate-900 hover:from-slate-800 hover:to-black transition disabled:opacity-50"
            >
              {salvando ? (
                <><Loader2 className="animate-spin" size={14} /> Salvando…</>
              ) : (
                <>Salvar</>
              )}
            </button>
          </div>
        </div>
      </div>
    </ModalBase>
  );
}
