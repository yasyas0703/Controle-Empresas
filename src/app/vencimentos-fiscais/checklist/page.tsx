'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ListChecks, Search, XCircle, Filter, Users, ChevronLeft, ChevronRight,
  Check, Calendar, AlertTriangle, TrendingUp, Award, Download, Clock,
  MessageSquare, History, User as UserIcon, Sparkles, Paperclip, Upload, Trash2, Eye, Loader2,
} from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import type { ChecklistFiscalItem, Empresa, UUID, Usuario } from '@/app/types';
import { VENCIMENTOS_FISCAIS_NOMES, VENCIMENTOS_FISCAIS_SN_NOMES, FISCAL_DEPT_NOME, FISCAL_SN_DEPT_NOME } from '@/app/types';
import * as db from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { sortByPtBr } from '@/lib/sort';
import { obrigacaoAplicaParaEmpresa, obrigacaoSnAplicaParaEmpresa } from '@/app/utils/regrasVencimentosFiscais';
import FiscalTabs from '@/app/vencimentos-fiscais/FiscalTabs';

type RegimeAba = 'fiscal' | 'sn';

type ChecklistKey = string; // `${empresaId}|${obrigacao}`

function monthKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
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
  const d = parseMonth(mes);
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function buildKey(empresaId: UUID, obrigacao: string): ChecklistKey {
  return `${empresaId}|${obrigacao}`;
}

function userInitials(nome: string): string {
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ChecklistFiscalPage() {
  const { empresas, departamentos, usuarios, currentUser, currentUserId, canManage, mostrarAlerta } = useSistema();

  const [mes, setMes] = useState<string>(() => currentMonth());
  const [aba, setAba] = useState<RegimeAba>('fiscal');
  const [items, setItems] = useState<Map<ChecklistKey, ChecklistFiscalItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [savingKeys, setSavingKeys] = useState<Set<ChecklistKey>>(new Set());

  // Overrides manuais: empresa+obrigação → habilitada (boolean).
  // - true  = forçada habilitar (override quando regra não cobre)
  // - false = forçada desabilitar (override pra desligar uma com regra)
  // - sem entrada no Map = sem override, segue a regra automática
  const [obrigacoesOverrides, setObrigacoesOverrides] = useState<Map<ChecklistKey, boolean>>(new Map());
  const [togglingHabilitacao, setTogglingHabilitacao] = useState<Set<ChecklistKey>>(new Set());

  const [search, setSearch] = useState('');
  const [filtroUsuario, setFiltroUsuario] = useState<string>('');
  const [filtroProgresso, setFiltroProgresso] = useState<'todos' | 'pendentes' | 'concluidas' | 'parciais'>('todos');
  const [apenasMinhas, setApenasMinhas] = useState(false);
  const apenasMinhasInitRef = useRef(false);

  const [obsTarget, setObsTarget] = useState<{ empresa: Empresa; obrigacao: string } | null>(null);
  const [obsText, setObsText] = useState('');
  const [savingObs, setSavingObs] = useState(false);

  const [histTarget, setHistTarget] = useState<{ empresa: Empresa; obrigacao: string } | null>(null);
  const [histItems, setHistItems] = useState<ChecklistFiscalItem[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const [arqTarget, setArqTarget] = useState<{ empresa: Empresa; obrigacao: string } | null>(null);
  const [arqUploading, setArqUploading] = useState(false);
  const [arqLoadingAcao, setArqLoadingAcao] = useState<'view' | 'download' | 'open' | null>(null);
  const [arqPreview, setArqPreview] = useState<boolean>(false);
  const [arqSignedUrl, setArqSignedUrl] = useState<string | null>(null);

  const fiscalDept = useMemo(
    () => departamentos.find((d) => d.nome.trim().toLowerCase() === FISCAL_DEPT_NOME)
      ?? departamentos.find((d) => {
        const n = d.nome.toLowerCase();
        return n.includes('fiscal') && !n.includes('sn');
      })
      ?? null,
    [departamentos]
  );

  const fiscalSnDept = useMemo(
    () => departamentos.find((d) => d.nome.trim().toLowerCase() === FISCAL_SN_DEPT_NOME) ?? null,
    [departamentos]
  );

  // Departamento "ativo" — varia conforme a aba (Fiscal x SN). Para usuário
  // comum, a aba é forçada para o seu próprio departamento (ver useEffect abaixo).
  const deptAtivo = aba === 'sn' ? fiscalSnDept : fiscalDept;

  // Lookup: id do usuário → seu departamentoId
  const userDeptById = useMemo(() => {
    const m = new Map<UUID, UUID | null>();
    for (const u of usuarios) m.set(u.id, u.departamentoId);
    return m;
  }, [usuarios]);

  // Verifica se o usuário pertence à aba ativa (pelo departamentoId dele).
  // Aba SN → só usuários com depto = fiscalSnDept.
  // Aba Fiscal → usuários SEM depto fiscal-SN (ou seja, fiscal regular ou qualquer outro depto que esteja como responsavel).
  const usuarioPertenceAba = useCallback((userId: UUID | null | undefined): boolean => {
    if (!userId) return false;
    const depId = userDeptById.get(userId) ?? null;
    if (aba === 'sn') return !!fiscalSnDept && depId === fiscalSnDept.id;
    // Aba Fiscal: tudo que NÃO é fiscal-SN
    return !(fiscalSnDept && depId === fiscalSnDept.id);
  }, [aba, fiscalSnDept, userDeptById]);

  // Pega o id do responsável fiscal da empresa, olhando em ambas as keys
  // (fiscal e fiscal-sn). Retorna o primeiro encontrado — uma empresa só
  // tem um responsável fiscal em qualquer momento.
  const getResponsavelFiscal = useCallback((empresa: Empresa): UUID | null => {
    if (fiscalDept) {
      const u = empresa.responsaveis?.[fiscalDept.id];
      if (u) return u;
    }
    if (fiscalSnDept) {
      const u = empresa.responsaveis?.[fiscalSnDept.id];
      if (u) return u;
    }
    return null;
  }, [fiscalDept, fiscalSnDept]);

  const fiscalUsers: Usuario[] = useMemo(() => {
    if (!deptAtivo) return [];
    // Quem aparece como responsavel em alguma empresa (qualquer key fiscal)
    const idsResp = new Set<UUID>();
    for (const e of empresas) {
      const uid = getResponsavelFiscal(e);
      if (uid && usuarioPertenceAba(uid)) idsResp.add(uid);
    }
    // Usuários ativos cujo depto é o da aba — sempre aparecem
    const doDepto = usuarios.filter((u) => u.ativo && u.departamentoId === deptAtivo.id);
    // Extras: usuário responsavel em alguma empresa mas que NÃO está no depto da aba.
    // (Pode ser legado ou alguém de outro depto que assumiu uma empresa.)
    const extras = usuarios.filter((u) => u.ativo && idsResp.has(u.id) && u.departamentoId !== deptAtivo.id);
    return sortByPtBr([...doDepto, ...extras], (u) => u.nome);
  }, [deptAtivo, empresas, usuarios, getResponsavelFiscal, usuarioPertenceAba]);

  // Lista de obrigações da aba ativa.
  const obrigacoesAba: readonly string[] = aba === 'sn' ? VENCIMENTOS_FISCAIS_SN_NOMES : VENCIMENTOS_FISCAIS_NOMES;

  const aplicaPelaRegra = useCallback((obrigacao: string, empresa: Empresa): boolean => {
    return aba === 'sn'
      ? obrigacaoSnAplicaParaEmpresa(obrigacao, empresa.estado, empresa.cidade)
      : obrigacaoAplicaParaEmpresa(obrigacao, empresa.estado, empresa.cidade);
  }, [aba]);

  // Override manual sobrescreve a regra. Sem override → segue regra automática.
  const aplicaObrigacao = useCallback((obrigacao: string, empresa: Empresa): boolean => {
    const override = obrigacoesOverrides.get(buildKey(empresa.id, obrigacao));
    if (typeof override === 'boolean') return override;
    return aplicaPelaRegra(obrigacao, empresa);
  }, [aplicaPelaRegra, obrigacoesOverrides]);

  // Para usuário comum: a aba é forçada conforme seu departamento.
  // Gerente/admin pode alternar livremente.
  useEffect(() => {
    if (canManage) return;
    if (currentUser?.departamentoId && fiscalSnDept && currentUser.departamentoId === fiscalSnDept.id) {
      setAba('sn');
    } else {
      setAba('fiscal');
    }
  }, [canManage, currentUser?.departamentoId, fiscalSnDept]);

  const isHoje = mes === currentMonth();

  // mostrarAlerta vem do contexto e não é estável (recriado a cada render).
  // Sem ref, `carregar` é recriado a cada render e o useEffect entra em loop
  // (carrega → some → carrega → some).
  const mostrarAlertaRef = useRef(mostrarAlerta);
  useEffect(() => { mostrarAlertaRef.current = mostrarAlerta; }, [mostrarAlerta]);

  // Load items for the selected month
  const carregar = useCallback(async (mesAlvo: string) => {
    setLoading(true);
    try {
      const lista = await db.fetchChecklistFiscalByMes(mesAlvo);
      const mapa = new Map<ChecklistKey, ChecklistFiscalItem>();
      for (const it of lista) mapa.set(buildKey(it.empresaId, it.obrigacao), it);
      setItems(mapa);
    } catch (err) {
      console.error(err);
      mostrarAlertaRef.current('Erro ao carregar', 'Não foi possível carregar o checklist deste mês.', 'erro');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregar(mes);
  }, [mes, carregar]);

  // Carrega os overrides manuais (independem do mês — valem pra todos).
  useEffect(() => {
    let cancelado = false;
    db.fetchObrigacoesOverrides()
      .then((lista) => {
        if (cancelado) return;
        const m = new Map<ChecklistKey, boolean>();
        for (const o of lista) m.set(buildKey(o.empresaId, o.obrigacao), o.habilitada);
        setObrigacoesOverrides(m);
      })
      .catch((err) => {
        console.error('Erro ao carregar overrides de obrigações:', err);
      });
    return () => { cancelado = true; };
  }, []);

  // Define se a obrigação aplica pra empresa (true = aplica, false = não aplica).
  // Usado pelos botões "+ Habilitar" (em N/A) e "X" (em célula ativa).
  const setHabilitacaoObrigacao = useCallback(async (empresa: Empresa, obrigacao: string, habilitada: boolean) => {
    const key = buildKey(empresa.id, obrigacao);
    if (togglingHabilitacao.has(key)) return;
    setTogglingHabilitacao((prev) => new Set(prev).add(key));
    try {
      await db.setObrigacaoHabilitacao({
        empresaId: empresa.id,
        obrigacao,
        habilitada,
        porId: currentUserId ?? undefined,
        porNome: currentUser?.nome ?? undefined,
      });
      setObrigacoesOverrides((prev) => {
        const next = new Map(prev);
        next.set(key, habilitada);
        return next;
      });
    } catch (err) {
      console.error('Erro ao alterar habilitação da obrigação:', err);
      mostrarAlertaRef.current('Erro', 'Não foi possível alterar a habilitação. Tente novamente.', 'erro');
    } finally {
      setTogglingHabilitacao((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [togglingHabilitacao, currentUserId, currentUser?.nome]);

  // Para usuário comum (não gerente/admin), o filtro "minhas empresas" é FORÇADO
  // — não vê empresas dos outros responsáveis. Gerente/admin: default off, livre p/ alternar.
  useEffect(() => {
    if (!currentUserId) return;
    if (!canManage) {
      // não-gerente: sempre travado em true
      setApenasMinhas(true);
      // limpa qualquer filtro de outro usuário
      setFiltroUsuario('');
    } else if (!apenasMinhasInitRef.current) {
      apenasMinhasInitRef.current = true;
      // gerente: deixa como está (default false)
    }
  }, [currentUserId, canManage]);

  // Realtime: atualiza automaticamente quando outro usuário marca/desmarca
  useEffect(() => {
    const channel = supabase
      .channel(`checklist-fiscal-${mes}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checklist_fiscal', filter: `mes=eq.${mes}` }, (payload: any) => {
        const row = payload.new ?? payload.old;
        if (!row) return;
        if (payload.eventType === 'DELETE') {
          setItems((prev) => {
            const next = new Map(prev);
            next.delete(buildKey(row.empresa_id, row.obrigacao));
            return next;
          });
        } else {
          const statusRow = row.status === 'feito' || row.status === 'sem_obrigacao' ? row.status : null;
          const item: ChecklistFiscalItem = {
            id: row.id,
            empresaId: row.empresa_id,
            mes: row.mes,
            obrigacao: row.obrigacao,
            concluido: !!row.concluido,
            status: statusRow,
            concluidoPorId: row.concluido_por_id,
            concluidoPorNome: row.concluido_por_nome ?? undefined,
            concluidoEm: row.concluido_em ?? undefined,
            observacao: row.observacao ?? undefined,
            criadoEm: row.criado_em ?? '',
            atualizadoEm: row.atualizado_em ?? '',
          };
          setItems((prev) => {
            const next = new Map(prev);
            next.set(buildKey(item.empresaId, item.obrigacao), item);
            return next;
          });
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [mes]);

  // Marca/desmarca uma célula. status null = limpa
  const toggle = async (empresa: Empresa, obrigacao: string, novo: 'feito' | 'sem_obrigacao' | null) => {
    const key = buildKey(empresa.id, obrigacao);
    const atual = items.get(key);
    setSavingKeys((prev) => new Set(prev).add(key));

    // Optimistic update
    setItems((prev) => {
      const next = new Map(prev);
      if (novo) {
        next.set(key, {
          id: atual?.id ?? 'tmp',
          empresaId: empresa.id,
          mes,
          obrigacao,
          concluido: novo === 'feito',
          status: novo,
          concluidoPorId: currentUserId ?? null,
          concluidoPorNome: currentUser?.nome,
          concluidoEm: new Date().toISOString(),
          observacao: atual?.observacao,
          arquivoUrl: atual?.arquivoUrl,
          arquivoNome: atual?.arquivoNome,
          arquivoHistorico: atual?.arquivoHistorico,
          criadoEm: atual?.criadoEm ?? new Date().toISOString(),
          atualizadoEm: new Date().toISOString(),
        });
      } else if (atual) {
        next.set(key, { ...atual, concluido: false, status: null, concluidoPorId: null, concluidoPorNome: undefined, concluidoEm: undefined });
      }
      return next;
    });

    try {
      await db.upsertChecklistFiscal({
        empresaId: empresa.id,
        mes,
        obrigacao,
        status: novo,
        concluidoPorId: currentUserId,
        concluidoPorNome: currentUser?.nome,
        observacao: atual?.observacao ?? null,
      });
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro ao salvar', 'Não foi possível atualizar o checklist. Tente novamente.', 'erro');
      // rollback
      setItems((prev) => {
        const next = new Map(prev);
        if (atual) next.set(key, atual);
        else next.delete(key);
        return next;
      });
    } finally {
      setSavingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const abrirObservacao = (empresa: Empresa, obrigacao: string) => {
    const atual = items.get(buildKey(empresa.id, obrigacao));
    setObsText(atual?.observacao ?? '');
    setObsTarget({ empresa, obrigacao });
  };

  const salvarObservacao = async () => {
    if (!obsTarget) return;
    setSavingObs(true);
    try {
      await db.updateChecklistObservacao(obsTarget.empresa.id, mes, obsTarget.obrigacao, obsText);
      mostrarAlerta('Observação salva', 'A observação foi registrada no checklist.', 'sucesso');
      setObsTarget(null);
      setObsText('');
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível salvar a observação.', 'erro');
    } finally {
      setSavingObs(false);
    }
  };

  const abrirArquivoTarget = (empresa: Empresa, obrigacao: string) => {
    setArqTarget({ empresa, obrigacao });
    setArqPreview(false);
    setArqSignedUrl(null);
  };

  const fazerUploadArquivo = async (file: File) => {
    if (!arqTarget) return;
    setArqUploading(true);
    try {
      const result = await db.uploadChecklistArquivo(
        arqTarget.empresa.id,
        mes,
        arqTarget.obrigacao,
        file,
        { autorId: currentUserId, autorNome: currentUser?.nome },
      );
      const key = buildKey(arqTarget.empresa.id, arqTarget.obrigacao);
      setItems((prev) => {
        const next = new Map(prev);
        next.set(key, result.item);
        return next;
      });
      // Reseta preview/url do arquivo anterior
      setArqPreview(false);
      setArqSignedUrl(null);
      mostrarAlerta('Arquivo anexado', `${result.arquivoNome} foi salvo neste checklist.`, 'sucesso');
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      mostrarAlerta('Erro ao anexar', msg, 'erro');
    } finally {
      setArqUploading(false);
    }
  };

  // Resolve signed URL com cache no state (não reabre em cada clique)
  const resolverSignedUrl = async (arquivoUrl: string): Promise<string | null> => {
    if (arqSignedUrl) return arqSignedUrl;
    try {
      const url = await db.getChecklistArquivoSignedUrl(arquivoUrl);
      setArqSignedUrl(url);
      return url;
    } catch {
      // Fallback: tenta usar a URL direta (legado)
      return arquivoUrl;
    }
  };

  const togglePreviewArquivo = async (arquivoUrl: string) => {
    if (arqPreview) {
      setArqPreview(false);
      return;
    }
    setArqLoadingAcao('view');
    try {
      const url = await resolverSignedUrl(arquivoUrl);
      if (url) setArqPreview(true);
    } finally {
      setArqLoadingAcao(null);
    }
  };

  const abrirArquivoNovaAba = async (arquivoUrl: string) => {
    setArqLoadingAcao('open');
    try {
      const url = await resolverSignedUrl(arquivoUrl);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível abrir o arquivo.', 'erro');
    } finally {
      setArqLoadingAcao(null);
    }
  };

  const baixarArquivo = async (arquivoUrl: string, fileName: string) => {
    setArqLoadingAcao('download');
    try {
      const url = await resolverSignedUrl(arquivoUrl);
      if (!url) return;
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      } catch {
        // Fallback CORS: abre em nova aba
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } finally {
      setArqLoadingAcao(null);
    }
  };

  const removerArquivoChecklist = async () => {
    if (!arqTarget) return;
    const key = buildKey(arqTarget.empresa.id, arqTarget.obrigacao);
    const atual = items.get(key);
    if (!atual?.arquivoUrl) return;
    setArqUploading(true);
    try {
      const item = await db.removeChecklistArquivo(
        arqTarget.empresa.id,
        mes,
        arqTarget.obrigacao,
        atual.arquivoUrl,
        { autorId: currentUserId, autorNome: currentUser?.nome },
      );
      setItems((prev) => {
        const next = new Map(prev);
        next.set(key, item);
        return next;
      });
      setArqPreview(false);
      setArqSignedUrl(null);
      mostrarAlerta('Arquivo removido', 'O anexo foi excluído deste checklist.', 'sucesso');
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível remover o arquivo.', 'erro');
    } finally {
      setArqUploading(false);
    }
  };

  const abrirHistorico = async (empresa: Empresa, obrigacao: string) => {
    setHistTarget({ empresa, obrigacao });
    setHistItems([]);
    setHistLoading(true);
    try {
      const { data, error } = await supabase
        .from('checklist_fiscal')
        .select('*')
        .eq('empresa_id', empresa.id)
        .eq('obrigacao', obrigacao)
        .order('mes', { ascending: false });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped: ChecklistFiscalItem[] = (data ?? []).map((row: any) => ({
        id: row.id,
        empresaId: row.empresa_id,
        mes: row.mes,
        obrigacao: row.obrigacao,
        concluido: !!row.concluido,
        concluidoPorId: row.concluido_por_id,
        concluidoPorNome: row.concluido_por_nome ?? undefined,
        concluidoEm: row.concluido_em ?? undefined,
        observacao: row.observacao ?? undefined,
        criadoEm: row.criado_em ?? '',
        atualizadoEm: row.atualizado_em ?? '',
      }));
      setHistItems(mapped);
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível carregar o histórico desta obrigação.', 'erro');
    } finally {
      setHistLoading(false);
    }
  };

  // Linhas da tabela (empresas filtradas) — cada linha é uma empresa
  const linhas = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = empresas
      .filter((e) => e.cadastrada !== false)
      .map((empresa) => {
        const respId = getResponsavelFiscal(empresa);
        const cells: { obrigacao: string; item: ChecklistFiscalItem | undefined; aplica: boolean }[] =
          obrigacoesAba.map((obrigacao) => {
            const aplica = aplicaObrigacao(obrigacao, empresa);
            return {
              obrigacao,
              aplica,
              item: aplica ? items.get(buildKey(empresa.id, obrigacao)) : undefined,
            };
          });
        // "sem_obrigacao" sai do denominador (a empresa não tem essa obrigação no mês)
        const aplicaveis = cells.filter((c) => c.aplica && c.item?.status !== 'sem_obrigacao');
        const feitas = aplicaveis.filter((c) => c.item?.concluido).length;
        const total = aplicaveis.length;
        const progresso = total === 0 ? 0 : (feitas / total) * 100;
        return { empresa, respId, cells, feitas, total, progresso };
      })
      .filter((l) => {
        // Empresas sem responsável fiscal ficam fora do checklist
        if (!l.respId) return false;
        // A empresa só aparece na aba se o departamento do RESPONSÁVEL bate
        // com a aba (Fiscal x Fiscal-SN). Assim, mover um usuário para
        // "Fiscal - SN" automaticamente migra as empresas dele para a aba SN.
        if (!usuarioPertenceAba(l.respId)) return false;
        if (q) {
          const hay = `${l.empresa.codigo} ${l.empresa.razao_social ?? ''} ${l.empresa.apelido ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        // Filtro de usuário só para gerentes (não-gerentes não enxergam outros)
        if (canManage && filtroUsuario) {
          if (l.respId !== filtroUsuario) return false;
        }
        // Não-gerentes: força ver só as próprias empresas
        if ((apenasMinhas || !canManage) && currentUserId) {
          if (l.respId !== currentUserId) return false;
        }
        if (filtroProgresso === 'pendentes' && l.feitas > 0) return false;
        if (filtroProgresso === 'concluidas' && l.feitas !== l.total) return false;
        if (filtroProgresso === 'parciais' && (l.feitas === 0 || l.feitas === l.total)) return false;
        return true;
      });

    return list.sort((a, b) => {
      // Ordem: parciais primeiro (in progress), depois pendentes, depois concluídas
      const stateA = a.feitas === 0 ? 1 : a.feitas === a.total ? 2 : 0;
      const stateB = b.feitas === 0 ? 1 : b.feitas === b.total ? 2 : 0;
      if (stateA !== stateB) return stateA - stateB;
      if (a.progresso !== b.progresso) return b.progresso - a.progresso;
      return a.empresa.codigo.localeCompare(b.empresa.codigo);
    });
  }, [empresas, items, search, filtroUsuario, apenasMinhas, currentUserId, canManage, filtroProgresso, getResponsavelFiscal, obrigacoesAba, aplicaObrigacao, usuarioPertenceAba]);

  // Stats
  const stats = useMemo(() => {
    const totalCells = linhas.reduce((s, l) => s + l.total, 0);
    const feitasCells = linhas.reduce((s, l) => s + l.feitas, 0);
    const empresasCompletas = linhas.filter((l) => l.total > 0 && l.feitas === l.total).length;
    const empresasPendentes = linhas.filter((l) => l.feitas === 0).length;
    const empresasParciais = linhas.filter((l) => l.feitas > 0 && l.feitas < l.total).length;
    const progressoGeral = totalCells === 0 ? 0 : (feitasCells / totalCells) * 100;
    // por obrigação — total considera empresas onde a obrigação se aplica E não foi marcada como "sem obrigação no mês"
    const porObrigacao = obrigacoesAba.map((obr) => {
      const aplicaveis = linhas.filter((l) => {
        const c = l.cells.find((c) => c.obrigacao === obr);
        return c?.aplica && c.item?.status !== 'sem_obrigacao';
      });
      const feitas = aplicaveis.filter((l) => l.cells.find((c) => c.obrigacao === obr)?.item?.concluido).length;
      const total = aplicaveis.length;
      return { obrigacao: obr, feitas, total, pct: total === 0 ? 0 : (feitas / total) * 100 };
    });
    return { totalCells, feitasCells, empresasCompletas, empresasPendentes, empresasParciais, progressoGeral, porObrigacao };
  }, [linhas, obrigacoesAba]);

  // Stats por usuário (para destacar)
  const statsPorUsuario = useMemo(() => {
    const map = new Map<UUID, { feitas: number; total: number }>();
    for (const u of fiscalUsers) map.set(u.id, { feitas: 0, total: 0 });
    for (const l of linhas) {
      if (!l.respId) continue;
      const s = map.get(l.respId);
      if (!s) continue;
      s.total += l.total;
      s.feitas += l.feitas;
    }
    return map;
  }, [fiscalUsers, linhas]);

  const hasFilters = !!search || !!filtroUsuario || filtroProgresso !== 'todos' || apenasMinhas;

  // Exportar CSV do mês atual filtrado
  const exportCSV = () => {
    const header = ['Código', 'Empresa', 'Responsável Fiscal', ...obrigacoesAba, 'Progresso (%)', 'Feitas/Total'];
    const rows = linhas.map((l) => {
      const resp = l.respId ? (usuarios.find((u) => u.id === l.respId)?.nome ?? '') : '';
      const cells = l.cells.map((c) => (!c.aplica ? 'N/A' : c.item?.status === 'sem_obrigacao' ? 'SEM OBR' : c.item?.concluido ? 'OK' : ''));
      return [l.empresa.codigo, l.empresa.razao_social || l.empresa.apelido || '', resp, ...cells, Math.round(l.progresso), `${l.feitas}/${l.total}`];
    });
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `checklist_${aba}_${mes}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Meses recentes para navegação rápida
  const mesesRapidos = useMemo(() => {
    const out: string[] = [];
    const hoje = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      out.push(monthKey(d));
    }
    return out;
  }, []);

  // Atalho teclado para navegar mês (apenas quando não estiver digitando)
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement === inputRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.key === 'ArrowLeft') setMes((m) => shiftMonth(m, -1));
      else if (e.key === 'ArrowRight') setMes((m) => shiftMonth(m, +1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!fiscalDept) {
    return (
      <div className="space-y-4 sm:space-y-6 min-w-0 max-w-full">
        <FiscalTabs />
        <div className="rounded-2xl bg-white p-8 shadow-sm text-center">
          <ListChecks className="mx-auto mb-4 text-gray-300" size={48} />
          <div className="text-lg font-bold text-gray-700 mb-1">Departamento Fiscal não encontrado</div>
          <div className="text-sm text-gray-500">Cadastre um departamento chamado &quot;Fiscal&quot; para usar o checklist mensal.</div>
        </div>
      </div>
    );
  }

  // Quando o usuário (gerente/admin) clica na aba SN, mas ainda não existe o depto Fiscal - SN.
  if (aba === 'sn' && !fiscalSnDept) {
    return (
      <div className="space-y-4 sm:space-y-6 min-w-0 max-w-full">
        <FiscalTabs />
        {canManage && (
          <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
            <div className="inline-flex items-center gap-1 rounded-xl bg-gray-100 p-1">
              <button onClick={() => setAba('fiscal')} className="rounded-lg px-4 py-1.5 text-xs sm:text-sm font-bold text-gray-600 hover:bg-white">Regime Normal</button>
              <button className="rounded-lg px-4 py-1.5 text-xs sm:text-sm font-bold bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 text-white shadow">SN</button>
            </div>
          </div>
        )}
        <div className="rounded-2xl bg-white p-8 shadow-sm text-center">
          <ListChecks className="mx-auto mb-4 text-gray-300" size={48} />
          <div className="text-lg font-bold text-gray-700 mb-1">Departamento &quot;Fiscal - SN&quot; não encontrado</div>
          <div className="text-sm text-gray-500 max-w-md mx-auto">
            Cadastre um departamento com o nome <span className="font-semibold text-gray-700">Fiscal - SN</span> em
            {' '}<a href="/departamentos" className="text-emerald-700 underline font-semibold">Departamentos</a> e vincule a ele os usuários do Simples Nacional para usar esta aba.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 max-w-full">
      <FiscalTabs />

      {/* Header */}
      <div className="rounded-2xl bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-2xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 flex items-center justify-center shadow-md shrink-0">
              <ListChecks className="text-white" size={22} />
            </div>
            <div className="min-w-0">
              <div className="text-lg sm:text-2xl font-bold text-gray-900">
                Checklist {aba === 'sn' ? 'Simples Nacional' : 'Fiscal'} Mensal
              </div>
              <div className="text-xs sm:text-sm text-gray-500">
                Marque conforme finalizar cada uma das {obrigacoesAba.length} obrigações. Cada mês tem seu próprio controle.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={exportCSV}
              className="inline-flex items-center gap-2 rounded-xl border-2 border-emerald-200 text-emerald-700 px-3 py-2 font-bold hover:bg-emerald-50 transition shrink-0"
            >
              <Download size={16} />
              <span className="hidden sm:inline">Exportar</span> CSV
            </button>
          </div>
        </div>

        {/* Abas Fiscal x SN — só gerente/admin alterna; usuário comum vê só a sua */}
        {canManage && (
          <div className="mt-4 inline-flex items-center gap-1 rounded-xl bg-gray-100 p-1">
            <button
              type="button"
              onClick={() => setAba('fiscal')}
              className={`rounded-lg px-4 py-1.5 text-xs sm:text-sm font-bold transition ${
                aba === 'fiscal'
                  ? 'bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 text-white shadow'
                  : 'text-gray-600 hover:bg-white'
              }`}
            >
              Regime Normal
            </button>
            <button
              type="button"
              onClick={() => setAba('sn')}
              className={`rounded-lg px-4 py-1.5 text-xs sm:text-sm font-bold transition ${
                aba === 'sn'
                  ? 'bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500 text-white shadow'
                  : 'text-gray-600 hover:bg-white'
              }`}
              title={fiscalSnDept ? 'Checklist do Simples Nacional' : 'Crie um departamento "Fiscal - SN" para usar esta aba'}
            >
              SN {!fiscalSnDept && <span className="ml-1 text-[10px] opacity-70">(sem depto)</span>}
            </button>
          </div>
        )}
      </div>

      {/* Seletor de mês */}
      <div className="rounded-2xl bg-gradient-to-r from-emerald-50 via-teal-50 to-cyan-50 border-2 border-emerald-100 p-3 sm:p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setMes((m) => shiftMonth(m, -1))}
              className="p-2 rounded-xl bg-white shadow-sm hover:shadow-md hover:bg-emerald-50 transition"
              title="Mês anterior (ou seta esquerda)"
            >
              <ChevronLeft size={18} className="text-emerald-700" />
            </button>
            <div className="flex items-center gap-2 bg-white rounded-xl px-3 sm:px-4 py-2 shadow-sm min-w-0">
              <Calendar size={18} className="text-emerald-600 shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Mês ativo</div>
                <div className="text-sm sm:text-base font-bold text-gray-900 capitalize truncate">{monthLabel(mes)}</div>
              </div>
              {isHoje && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-bold">
                  <Sparkles size={10} /> AGORA
                </span>
              )}
            </div>
            <button
              onClick={() => setMes((m) => shiftMonth(m, +1))}
              className="p-2 rounded-xl bg-white shadow-sm hover:shadow-md hover:bg-emerald-50 transition"
              title="Próximo mês (ou seta direita)"
            >
              <ChevronRight size={18} className="text-emerald-700" />
            </button>
            {!isHoje && (
              <button
                onClick={() => setMes(currentMonth())}
                className="hidden sm:inline-flex items-center gap-1 text-xs text-emerald-700 font-bold hover:text-emerald-800 px-2"
                title="Voltar para o mês atual"
              >
                Voltar ao mês atual
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mr-1">Rápido:</span>
            {mesesRapidos.map((m) => (
              <button
                key={m}
                onClick={() => setMes(m)}
                className={`rounded-lg px-2 py-1 text-[11px] font-bold transition ${
                  mes === m
                    ? 'bg-emerald-600 text-white shadow'
                    : 'bg-white text-gray-700 hover:bg-emerald-50 shadow-sm'
                }`}
              >
                {m === currentMonth() ? 'Este mês' : monthLabel(m).slice(0, 3) + '/' + m.slice(2, 4)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Dashboard Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} className="text-emerald-500" />
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-gray-500">Progresso geral</span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-emerald-700">{Math.round(stats.progressoGeral)}%</div>
          <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all" style={{ width: `${stats.progressoGeral}%` }} />
          </div>
          <div className="text-[10px] text-gray-400 mt-1">{stats.feitasCells} de {stats.totalCells} itens</div>
        </div>
        <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <Award size={14} className="text-emerald-500" />
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-gray-500">100% concluídas</span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-emerald-600">{stats.empresasCompletas}</div>
          <div className="text-[10px] text-gray-400 mt-1">empresas finalizadas</div>
        </div>
        <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={14} className="text-amber-500" />
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-gray-500">Em andamento</span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-amber-600">{stats.empresasParciais}</div>
          <div className="text-[10px] text-gray-400 mt-1">empresas parciais</div>
        </div>
        <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-red-500" />
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-gray-500">Não iniciadas</span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-red-600">{stats.empresasPendentes}</div>
          <div className="text-[10px] text-gray-400 mt-1">empresas sem marcar</div>
        </div>
        <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-1">
            <Users size={14} className="text-cyan-500" />
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-gray-500">Total empresas</span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-cyan-700">{linhas.length}</div>
          <div className="text-[10px] text-gray-400 mt-1">visíveis no filtro</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <Filter size={14} className="text-gray-400" />
            Filtros
          </div>
          {hasFilters && (
            <button
              onClick={() => { setSearch(''); setFiltroUsuario(''); setFiltroProgresso('todos'); setApenasMinhas(false); }}
              className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-bold"
            >
              <XCircle size={14} />
              Limpar
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar empresa..."
              className="w-full rounded-xl bg-gray-50 pl-10 pr-4 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-emerald-400 focus:bg-white transition"
            />
          </div>
          {canManage && (
            <select
              value={filtroUsuario}
              onChange={(e) => setFiltroUsuario(e.target.value)}
              className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-emerald-400"
            >
              <option value="">Todos responsáveis fiscais</option>
              {fiscalUsers.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          )}
          <select
            value={filtroProgresso}
            onChange={(e) => setFiltroProgresso(e.target.value as typeof filtroProgresso)}
            className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-emerald-400"
          >
            <option value="todos">Todas as empresas</option>
            <option value="pendentes">Só não iniciadas</option>
            <option value="parciais">Só em andamento</option>
            <option value="concluidas">Só 100% concluídas</option>
          </select>
          {canManage && (
            <button
              onClick={() => setApenasMinhas((v) => !v)}
              className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold border-2 transition ${
                apenasMinhas
                  ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
                  : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-emerald-300'
              }`}
              disabled={!currentUserId}
              title={!currentUserId ? 'Faça login para filtrar suas empresas' : undefined}
            >
              <UserIcon size={16} />
              {apenasMinhas ? 'Mostrando minhas' : 'Só minhas empresas'}
            </button>
          )}
        </div>
      </div>

      {/* Stats por usuário (chips) — só gerente vê o progresso de todos */}
      {canManage && fiscalUsers.length > 0 && (
        <div className="rounded-2xl bg-white p-3 sm:p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800 mb-2">
            <Users size={14} className="text-gray-400" />
            Progresso por responsável
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {fiscalUsers.map((u) => {
              const s = statsPorUsuario.get(u.id);
              const pct = !s || s.total === 0 ? 0 : (s.feitas / s.total) * 100;
              const isSelected = filtroUsuario === u.id;
              return (
                <button
                  key={u.id}
                  onClick={() => setFiltroUsuario((prev) => (prev === u.id ? '' : u.id))}
                  className={`rounded-xl p-2 text-left border-2 transition ${
                    isSelected ? 'border-emerald-500 bg-emerald-50 shadow' : 'border-gray-100 bg-gray-50 hover:border-emerald-300'
                  }`}
                  title={`${u.nome} - ${s?.feitas ?? 0}/${s?.total ?? 0} obrigações`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white text-[10px] font-black shrink-0">
                      {userInitials(u.nome)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-gray-900 truncate">{u.nome}</div>
                      <div className="text-[10px] text-gray-500">{s?.feitas ?? 0}/{s?.total ?? 0} feitas</div>
                    </div>
                  </div>
                  <div className="h-1.5 bg-white rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-400 to-teal-500" style={{ width: `${pct}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Grade principal */}
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden min-w-0 max-w-full">
        {loading ? (
          <div className="p-10 text-center text-gray-500">
            <ListChecks className="mx-auto mb-3 text-gray-300 animate-pulse" size={40} />
            <div className="text-sm font-semibold">Carregando checklist de {monthLabel(mes)}...</div>
          </div>
        ) : linhas.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            <ListChecks className="mx-auto mb-3 text-gray-300" size={40} />
            <div className="font-bold text-gray-700 mb-1">Nenhuma empresa encontrada</div>
            <div className="text-sm">Ajuste os filtros acima.</div>
          </div>
        ) : (
          <div className="w-full overflow-x-auto overflow-y-auto max-h-[75vh]">
            <table className="border-separate border-spacing-0 text-sm min-w-max">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 bg-gray-900 text-white text-[10px] font-bold uppercase tracking-wider text-left px-3 py-2 border-b-2 border-gray-700 w-[220px] min-w-[220px] max-w-[220px]">
                    Empresa / Responsável
                  </th>
                  <th className="sticky top-0 z-20 bg-gray-900 text-white text-[10px] font-bold uppercase tracking-wider text-center px-2 py-2 border-b-2 border-gray-700 w-[90px] min-w-[90px]">
                    Progresso
                  </th>
                  {obrigacoesAba.map((obr, idx) => {
                    const s = stats.porObrigacao[idx];
                    return (
                      <th
                        key={obr}
                        className="sticky top-0 z-20 bg-gray-900 text-white text-[9px] font-bold text-center px-1 py-2 border-b-2 border-gray-700 w-[90px] min-w-[90px] max-w-[90px]"
                        title={`${obr} — ${s.feitas}/${s.total} (${Math.round(s.pct)}%)`}
                      >
                        <div className="leading-tight px-1">{obr}</div>
                        <div className="mt-1 flex items-center justify-center gap-1">
                          <span className="rounded bg-emerald-600 px-1 text-[8px] font-black">{s.feitas}/{s.total}</span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const respUser = l.respId ? usuarios.find((u) => u.id === l.respId) : null;
                  const completa = l.total > 0 && l.feitas === l.total;
                  const vazia = l.feitas === 0;
                  return (
                    <tr
                      key={l.empresa.id}
                      className={`transition-colors ${completa ? 'bg-emerald-50/40' : vazia ? '' : 'bg-amber-50/30'}`}
                    >
                      <td className="sticky left-0 z-10 bg-white border-b border-gray-100 px-3 py-2 w-[220px] min-w-[220px] max-w-[220px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 shadow-sm ${
                            completa ? 'bg-gradient-to-br from-emerald-400 to-teal-500 text-white' :
                            vazia ? 'bg-gray-100 text-gray-400' :
                            'bg-gradient-to-br from-amber-300 to-orange-400 text-white'
                          }`}>
                            {completa ? <Check size={16} strokeWidth={3} /> : <span className="text-[10px] font-black">{Math.round(l.progresso)}%</span>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-gray-900 text-xs truncate">{l.empresa.codigo}</div>
                            <div className="text-[10px] text-gray-500 truncate" title={l.empresa.razao_social || l.empresa.apelido}>
                              {l.empresa.razao_social || l.empresa.apelido || '-'}
                            </div>
                            {respUser && (
                              <div className="text-[9px] text-emerald-700 font-semibold truncate mt-0.5">
                                {respUser.nome}
                              </div>
                            )}
                            {!respUser && (
                              <div className="text-[9px] text-red-500 font-semibold mt-0.5">sem responsável</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="border-b border-gray-100 px-2 py-2 w-[90px] min-w-[90px]">
                        <div className="text-center">
                          <div className={`text-sm font-black ${completa ? 'text-emerald-600' : vazia ? 'text-gray-400' : 'text-amber-600'}`}>
                            {l.feitas}/{l.total}
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
                            <div
                              className={`h-full transition-all ${completa ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-400 to-emerald-500'}`}
                              style={{ width: `${l.progresso}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      {l.cells.map(({ obrigacao, item, aplica }) => {
                        const canEdit = canManage || (!!currentUserId && l.respId === currentUserId);
                        const habKey = buildKey(l.empresa.id, obrigacao);
                        const isTogglingHab = togglingHabilitacao.has(habKey);

                        if (!aplica) {
                          return (
                            <td key={obrigacao} className="border-b border-gray-100 p-1 w-[90px] min-w-[90px] max-w-[90px]">
                              <div
                                className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50/60 p-1.5 flex flex-col items-center justify-center gap-1 min-h-[64px]"
                                title={`${obrigacao} não se aplica a esta empresa.`}
                              >
                                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">N/A</span>
                                {canEdit && (
                                  <button
                                    type="button"
                                    onClick={() => setHabilitacaoObrigacao(l.empresa, obrigacao, true)}
                                    disabled={isTogglingHab}
                                    className="text-[9px] font-bold uppercase tracking-wider rounded-md border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50 px-2 py-0.5 transition disabled:opacity-60"
                                    title={`Habilitar ${obrigacao} pra esta empresa (vale pra todos os meses)`}
                                  >
                                    {isTogglingHab ? <Loader2 size={10} className="animate-spin" /> : '+ Habilitar'}
                                  </button>
                                )}
                              </div>
                            </td>
                          );
                        }
                        const key = buildKey(l.empresa.id, obrigacao);
                        const saving = savingKeys.has(key);
                        const feito = !!item?.concluido;
                        const semObr = item?.status === 'sem_obrigacao';
                        const temObs = !!(item?.observacao && item.observacao.trim());
                        const temArquivo = !!item?.arquivoUrl;

                        const handleClickStatus = (alvo: 'feito' | 'sem_obrigacao') => {
                          if (!canEdit || saving) return;
                          // clicar no estado já ativo desmarca
                          const atual = item?.status ?? null;
                          toggle(l.empresa, obrigacao, atual === alvo ? null : alvo);
                        };

                        return (
                          <td key={obrigacao} className="border-b border-gray-100 p-1 w-[90px] min-w-[90px] max-w-[90px]">
                            <div
                              className={`group relative rounded-lg border-2 p-1.5 transition ${
                                feito
                                  ? 'bg-emerald-50 border-emerald-300 hover:border-emerald-500'
                                  : semObr
                                    ? 'bg-rose-50 border-rose-300 hover:border-rose-500'
                                    : 'bg-gray-50 border-gray-200 hover:border-emerald-300'
                              } ${saving ? 'opacity-60' : ''}`}
                            >
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => setHabilitacaoObrigacao(l.empresa, obrigacao, false)}
                                  disabled={isTogglingHab}
                                  className="absolute -top-1.5 -right-1.5 z-10 inline-flex items-center justify-center h-4 w-4 rounded-full bg-white text-gray-400 hover:text-rose-600 hover:bg-rose-50 border border-gray-300 hover:border-rose-400 shadow-sm opacity-0 group-hover:opacity-100 transition disabled:opacity-60"
                                  title={`Desabilitar ${obrigacao} pra esta empresa (vale pra todos os meses, pode reabilitar depois)`}
                                >
                                  {isTogglingHab ? <Loader2 size={8} className="animate-spin" /> : <XCircle size={11} strokeWidth={2.5} />}
                                </button>
                              )}
                              <div className="grid grid-cols-2 gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleClickStatus('feito')}
                                  disabled={!canEdit || saving}
                                  className={`flex items-center justify-center h-7 rounded-md transition ${
                                    feito
                                      ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm'
                                      : canEdit
                                        ? 'bg-white border border-gray-300 hover:border-emerald-500 hover:bg-emerald-50 text-gray-400 hover:text-emerald-600'
                                        : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                                  }`}
                                  title={
                                    !canEdit ? 'Sem permissão (responsável fiscal ou gerente)' :
                                    feito ? `Feito por ${item?.concluidoPorNome ?? '-'} em ${item?.concluidoEm ? new Date(item.concluidoEm).toLocaleString('pt-BR') : '-'}\nClique para desmarcar` :
                                    'Marcar como feito'
                                  }
                                >
                                  <Check size={16} strokeWidth={3} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleClickStatus('sem_obrigacao')}
                                  disabled={!canEdit || saving}
                                  className={`flex items-center justify-center h-7 rounded-md transition ${
                                    semObr
                                      ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-sm'
                                      : canEdit
                                        ? 'bg-white border border-gray-300 hover:border-rose-500 hover:bg-rose-50 text-gray-400 hover:text-rose-600'
                                        : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                                  }`}
                                  title={
                                    !canEdit ? 'Sem permissão (responsável fiscal ou gerente)' :
                                    semObr ? `Sem obrigação neste mês\nMarcado por ${item?.concluidoPorNome ?? '-'}\nClique para desmarcar` :
                                    'Marcar como SEM obrigação neste mês'
                                  }
                                >
                                  <XCircle size={16} strokeWidth={2.5} />
                                </button>
                              </div>
                              {(feito || semObr) && item?.concluidoPorNome && (
                                <div className={`mt-1 text-[9px] font-bold text-center truncate ${feito ? 'text-emerald-700' : 'text-rose-700'}`} title={item.concluidoPorNome}>
                                  {item.concluidoPorNome.split(' ')[0]}
                                </div>
                              )}
                              <div className="mt-1 flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => abrirObservacao(l.empresa, obrigacao)}
                                  className={`p-0.5 rounded hover:bg-white transition ${temObs ? 'text-violet-600' : 'text-gray-300 hover:text-violet-500'}`}
                                  title={temObs ? `Observação: ${item?.observacao}` : 'Adicionar observação'}
                                >
                                  <MessageSquare size={11} strokeWidth={temObs ? 2.5 : 2} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => abrirArquivoTarget(l.empresa, obrigacao)}
                                  className={`p-0.5 rounded hover:bg-white transition ${temArquivo ? 'text-amber-600' : 'text-gray-300 hover:text-amber-500'}`}
                                  title={temArquivo ? `Anexo: ${item?.arquivoNome ?? 'arquivo'}` : 'Anexar guia/comprovante'}
                                >
                                  <Paperclip size={11} strokeWidth={temArquivo ? 2.5 : 2} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => abrirHistorico(l.empresa, obrigacao)}
                                  className="p-0.5 rounded text-gray-300 hover:text-cyan-600 hover:bg-white transition"
                                  title="Ver histórico desta obrigação"
                                >
                                  <History size={11} />
                                </button>
                              </div>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && linhas.length > 0 && (
          <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-500 flex items-center justify-between flex-wrap gap-x-3 gap-y-1.5 min-w-0">
            <div className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0">
              <span className="whitespace-nowrap">Exibindo {linhas.length} empresa(s)</span>
              <span className="text-gray-300">•</span>
              <span className="whitespace-nowrap font-bold text-emerald-700">{stats.feitasCells} de {stats.totalCells} marcadas</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1">
                <MessageSquare size={11} className="text-violet-500" />
                <span>observação</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <Paperclip size={11} className="text-amber-500" />
                <span>anexo</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <History size={11} className="text-cyan-500" />
                <span>histórico</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-white border border-gray-200 font-mono text-[10px]">←</kbd>
                <kbd className="px-1.5 py-0.5 rounded bg-white border border-gray-200 font-mono text-[10px]">→</kbd>
                <span>navegar meses</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Observação */}
      {obsTarget && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onMouseDown={(e) => e.currentTarget === e.target && !savingObs && setObsTarget(null)}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-violet-600 to-purple-600 px-5 py-4 flex items-center justify-between">
              <div className="text-white min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider opacity-90">Observação • {monthLabel(mes)}</div>
                <div className="text-sm font-bold truncate">{obsTarget.empresa.codigo} — {obsTarget.obrigacao}</div>
              </div>
              <button
                onClick={() => !savingObs && setObsTarget(null)}
                className="rounded-lg p-2 bg-white/20 hover:bg-white/30 text-white transition shrink-0"
              >
                <XCircle size={20} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <textarea
                value={obsText}
                onChange={(e) => setObsText(e.target.value)}
                rows={5}
                placeholder="Ex: Cliente pediu prazo até dia 25..."
                className="w-full rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-violet-400 focus:bg-white transition"
                autoFocus
              />
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => !savingObs && setObsTarget(null)}
                  className="rounded-xl px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 transition"
                  disabled={savingObs}
                >
                  Cancelar
                </button>
                <button
                  onClick={salvarObservacao}
                  disabled={savingObs}
                  className="rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white px-4 py-2 text-sm font-bold hover:from-violet-700 hover:to-purple-700 shadow transition disabled:opacity-50"
                >
                  {savingObs ? 'Salvando...' : 'Salvar observação'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Anexar arquivo (guia/comprovante) */}
      {arqTarget && (() => {
        const itemAtual = items.get(buildKey(arqTarget.empresa.id, arqTarget.obrigacao));
        const arquivoUrl = itemAtual?.arquivoUrl;
        const arquivoNome = itemAtual?.arquivoNome ?? 'arquivo';
        const temArq = !!arquivoUrl;
        const arquivoHistorico = itemAtual?.arquivoHistorico ?? [];
        const temHistArquivo = arquivoHistorico.length > 0;
        const podeEditar = canManage || (!!currentUserId && (() => {
          const respId = arqTarget.empresa.responsaveis?.[deptAtivo?.id ?? ''];
          return respId === currentUserId;
        })());
        const fechar = () => {
          if (arqUploading) return;
          setArqTarget(null);
          setArqPreview(false);
          setArqSignedUrl(null);
        };
        return (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            onMouseDown={(e) => e.currentTarget === e.target && fechar()}
          >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div className={`relative w-full ${arqPreview ? 'max-w-4xl' : 'max-w-md'} rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-all`}>
              <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 flex items-center justify-between shrink-0">
                <div className="text-white min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider opacity-90">Anexo • {monthLabel(mes)}</div>
                  <div className="text-sm font-bold truncate">{arqTarget.empresa.codigo} — {arqTarget.obrigacao}</div>
                </div>
                <button
                  onClick={fechar}
                  className="rounded-lg p-2 bg-white/20 hover:bg-white/30 text-white transition shrink-0"
                >
                  <XCircle size={20} />
                </button>
              </div>

              <div className="p-5 space-y-3 overflow-y-auto">
                {temArq && arquivoUrl ? (
                  <>
                    {/* Card com info + botões de ação (padrão dos outros modais) */}
                    <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-3">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="h-10 w-10 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0">
                          <Paperclip size={18} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-amber-900 truncate" title={arquivoNome}>
                            {arquivoNome}
                          </div>
                          <div className="text-[10px] text-amber-700">Anexado neste checklist mensal</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          onClick={() => void togglePreviewArquivo(arquivoUrl)}
                          disabled={arqLoadingAcao !== null}
                          className={`rounded-xl border p-2 hover:bg-orange-100 transition ${arqPreview ? 'bg-orange-200 border-orange-400' : 'bg-white border-orange-200'}`}
                          title={arqPreview ? 'Fechar visualização' : 'Visualizar arquivo'}
                        >
                          {arqLoadingAcao === 'view' ? (
                            <Loader2 className="text-orange-600 animate-spin" size={16} />
                          ) : (
                            <Eye className="text-orange-600" size={16} />
                          )}
                        </button>
                        <button
                          onClick={() => void abrirArquivoNovaAba(arquivoUrl)}
                          disabled={arqLoadingAcao !== null}
                          className="rounded-xl border border-orange-200 bg-white p-2 hover:bg-orange-100 transition"
                          title="Abrir em nova aba"
                        >
                          {arqLoadingAcao === 'open' ? (
                            <Loader2 className="text-orange-600 animate-spin" size={16} />
                          ) : (
                            <Paperclip className="text-orange-600" size={16} />
                          )}
                        </button>
                        <button
                          onClick={() => void baixarArquivo(arquivoUrl, arquivoNome)}
                          disabled={arqLoadingAcao !== null}
                          className="rounded-xl border border-blue-200 bg-white p-2 hover:bg-blue-50 transition"
                          title="Baixar arquivo"
                        >
                          {arqLoadingAcao === 'download' ? (
                            <Loader2 className="text-blue-600 animate-spin" size={16} />
                          ) : (
                            <Download className="text-blue-600" size={16} />
                          )}
                        </button>
                        {podeEditar && (
                          <button
                            onClick={removerArquivoChecklist}
                            disabled={arqUploading}
                            className="rounded-xl border border-red-200 bg-white p-2 hover:bg-red-50 transition"
                            title="Excluir anexo"
                          >
                            {arqUploading ? (
                              <Loader2 className="text-red-500 animate-spin" size={16} />
                            ) : (
                              <Trash2 className="text-red-500" size={16} />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Preview iframe inline (segue o padrão do ModalDetalhesEmpresa) */}
                    {arqPreview && arqSignedUrl && (
                      <div className="rounded-xl border border-orange-200 bg-orange-50/50 overflow-hidden" style={{ height: 480 }}>
                        <iframe
                          src={arqSignedUrl}
                          className="w-full h-full border-0"
                          title={`Preview: ${arquivoNome}`}
                        />
                      </div>
                    )}

                    {/* Substituir arquivo */}
                    {podeEditar && (
                      <label className="block">
                        <input
                          type="file"
                          accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt"
                          className="hidden"
                          disabled={arqUploading}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void fazerUploadArquivo(f);
                            e.target.value = '';
                          }}
                        />
                        <div className={`rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/50 px-4 py-3 text-center text-xs font-bold cursor-pointer transition ${arqUploading ? 'opacity-50 cursor-wait' : 'hover:bg-amber-100'} text-amber-700`}>
                          {arqUploading ? 'Enviando...' : 'Substituir arquivo'}
                        </div>
                      </label>
                    )}
                  </>
                ) : podeEditar ? (
                  <label className="block cursor-pointer">
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt"
                      className="hidden"
                      disabled={arqUploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void fazerUploadArquivo(f);
                        e.target.value = '';
                      }}
                    />
                    <div className={`rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/50 p-8 text-center transition ${arqUploading ? 'opacity-50 cursor-wait' : 'hover:bg-amber-100'}`}>
                      {arqUploading ? (
                        <Loader2 size={32} className="mx-auto mb-2 text-amber-500 animate-spin" />
                      ) : (
                        <Upload size={32} className="mx-auto mb-2 text-amber-500" />
                      )}
                      <div className="text-sm font-bold text-amber-800">
                        {arqUploading ? 'Enviando arquivo...' : 'Clique para anexar guia/comprovante'}
                      </div>
                      <div className="text-[11px] text-amber-700 mt-1">
                        PDF, DOC, XLS, PNG, JPG · até 10MB
                      </div>
                    </div>
                  </label>
                ) : (
                  <div className="rounded-xl bg-gray-50 border border-gray-200 p-6 text-center text-sm text-gray-500">
                    Nenhum arquivo anexado.<br />
                    <span className="text-[11px]">Apenas o responsável fiscal ou gerente pode anexar.</span>
                  </div>
                )}

                {/* Histórico de anexos (anexar / substituir / remover) */}
                {temHistArquivo && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-600 mb-2">
                      <History size={12} className="text-gray-500" />
                      Histórico do anexo
                      <span className="ml-auto rounded-full bg-gray-200 px-1.5 py-0.5 text-[9px] font-black text-gray-700">
                        {arquivoHistorico.length}
                      </span>
                    </div>
                    <ol className="space-y-1.5">
                      {arquivoHistorico.map((ev) => {
                        const isAnexado = ev.titulo === 'Arquivo anexado';
                        const isSubstituido = ev.titulo === 'Arquivo substituído';
                        const isRemovido = ev.titulo === 'Arquivo removido';
                        const cor = isRemovido
                          ? { bg: 'bg-red-50', border: 'border-red-200', txt: 'text-red-700', dot: 'bg-red-500' }
                          : isSubstituido
                            ? { bg: 'bg-blue-50', border: 'border-blue-200', txt: 'text-blue-700', dot: 'bg-blue-500' }
                            : { bg: 'bg-emerald-50', border: 'border-emerald-200', txt: 'text-emerald-700', dot: 'bg-emerald-500' };
                        const dataFmt = ev.criadoEm
                          ? new Date(ev.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                          : '';
                        return (
                          <li key={ev.id} className={`rounded-lg border ${cor.border} ${cor.bg} px-2.5 py-1.5`}>
                            <div className="flex items-start gap-2">
                              <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${cor.dot}`} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className={`text-[11px] font-bold ${cor.txt}`}>
                                    {isAnexado && '+ Arquivo anexado'}
                                    {isSubstituido && '↻ Arquivo substituído'}
                                    {isRemovido && '× Arquivo removido'}
                                  </span>
                                  <span className="text-[10px] text-gray-500 whitespace-nowrap">{dataFmt}</span>
                                </div>
                                {ev.autorNome && (
                                  <div className="text-[10px] text-gray-600">
                                    por <span className="font-semibold">{ev.autorNome}</span>
                                  </div>
                                )}
                                {ev.descricao && (
                                  <div className="text-[10px] text-gray-500 truncate" title={ev.descricao}>
                                    {ev.descricao}
                                  </div>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal: Histórico */}
      {histTarget && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onMouseDown={(e) => e.currentTarget === e.target && setHistTarget(null)}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative w-full max-w-2xl max-h-[80vh] rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col">
            <div className="bg-gradient-to-r from-cyan-600 to-teal-600 px-5 py-4 flex items-center justify-between">
              <div className="text-white min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider opacity-90">Histórico da obrigação</div>
                <div className="text-sm font-bold truncate">{histTarget.empresa.codigo} — {histTarget.obrigacao}</div>
              </div>
              <button
                onClick={() => setHistTarget(null)}
                className="rounded-lg p-2 bg-white/20 hover:bg-white/30 text-white transition shrink-0"
              >
                <XCircle size={20} />
              </button>
            </div>
            <div className="p-5 overflow-y-auto">
              {histLoading ? (
                <div className="text-center text-gray-500 py-8">
                  <History size={32} className="mx-auto mb-2 text-gray-300 animate-pulse" />
                  Carregando...
                </div>
              ) : histItems.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <History size={32} className="mx-auto mb-2 text-gray-300" />
                  Ainda não há registros desta obrigação.
                </div>
              ) : (
                <div className="space-y-2">
                  {histItems.map((it) => (
                    <div
                      key={it.id}
                      className={`rounded-xl border-2 p-3 ${it.concluido ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-200 bg-gray-50/50'}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            it.concluido ? 'bg-emerald-500 text-white' : 'bg-gray-300 text-gray-700'
                          }`}>
                            {it.concluido ? <><Check size={10} strokeWidth={3} /> FEITO</> : 'PENDENTE'}
                          </span>
                          <span className="text-sm font-bold text-gray-800 capitalize">{monthLabel(it.mes)}</span>
                        </div>
                        {it.concluidoEm && (
                          <span className="text-[10px] text-gray-500">
                            {new Date(it.concluidoEm).toLocaleString('pt-BR')}
                          </span>
                        )}
                      </div>
                      {it.concluidoPorNome && (
                        <div className="text-xs text-emerald-700 font-semibold">por {it.concluidoPorNome}</div>
                      )}
                      {it.observacao && (
                        <div className="mt-2 rounded-lg bg-white border border-violet-100 p-2 text-xs text-gray-700">
                          <div className="text-[10px] font-bold text-violet-600 mb-1 uppercase tracking-wide">Observação</div>
                          {it.observacao}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
