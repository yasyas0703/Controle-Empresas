'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, Search, X, Square, Play } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import type { Empresa } from '@/app/types';
import { api } from '@/app/utils/api';
import { formatarDocumento } from '@/app/utils/validation';
import ModalBase from '@/app/components/ModalBase';

const DELAY_MS = 3000;
const RATE_LIMIT_BACKOFF_MS = 60_000;

type Status = 'pendente' | 'buscando' | 'sucesso' | 'erro' | 'cancelada';

interface Item {
  empresa: Empresa;
  status: Status;
  mensagem?: string;
  camposAtualizados?: number;
}

function digitsOnly(value: string | undefined | null): string {
  return String(value || '').replace(/\D/g, '');
}

function formatCep(value: string | undefined | null): string {
  const d = digitsOnly(value);
  if (d.length === 8) return `${d.slice(0, 5)}-${d.slice(5, 8)}`;
  return String(value || '');
}

export default function ModalEncontrarCnpjs({ onClose }: { onClose: () => void }) {
  const { empresas, atualizarEmpresa } = useSistema();

  const candidatas = useMemo(() => {
    const semEndereco = (e: Empresa) => {
      const cidade = String(e.cidade || '').trim();
      const estado = String(e.estado || '').trim();
      const logradouro = String(e.logradouro || '').trim();
      const cep = digitsOnly(e.cep);
      return !cidade || !estado || !logradouro || cep.length !== 8;
    };
    return empresas
      .filter((e) => digitsOnly(e.cnpj).length === 14)
      .filter((e) => !e.desligada_em)
      .filter(semEndereco)
      .sort((a, b) => (a.razao_social || a.apelido || a.codigo || '').localeCompare(b.razao_social || b.apelido || b.codigo || ''));
  }, [empresas]);

  const [items, setItems] = useState<Item[]>(() =>
    candidatas.map((e) => ({ empresa: e, status: 'pendente' as Status }))
  );
  const [rodando, setRodando] = useState(false);
  const [indiceAtual, setIndiceAtual] = useState(-1);
  const [resumo, setResumo] = useState({ sucesso: 0, erro: 0 });

  const cancelarRef = useRef(false);
  const rodandoRef = useRef(false);

  useEffect(() => {
    if (rodando) return;
    setItems(candidatas.map((e) => ({ empresa: e, status: 'pendente' as Status })));
  }, [candidatas, rodando]);

  const totalPendente = items.filter((i) => i.status === 'pendente').length;
  const totalSucesso = items.filter((i) => i.status === 'sucesso').length;
  const totalErro = items.filter((i) => i.status === 'erro').length;
  const totalProcessado = items.length - totalPendente;
  const progresso = items.length === 0 ? 0 : Math.round((totalProcessado / items.length) * 100);

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (cancelarRef.current) return resolve();
        if (Date.now() - start >= ms) return resolve();
        window.setTimeout(tick, 200);
      };
      tick();
    });

  const atualizarItem = (idx: number, patch: Partial<Item>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const aplicarRetorno = async (
    empresa: Empresa,
    data: Awaited<ReturnType<typeof api.consultarCnpj>>
  ): Promise<number> => {
    const patch: Partial<Empresa> = {};
    let mudados = 0;

    const setIfChanged = <K extends keyof Empresa>(campo: K, valor: Empresa[K]) => {
      const novo = (valor ?? '') as unknown as string;
      const atual = (empresa[campo] ?? '') as unknown as string;
      if (String(novo).trim() && String(novo).trim() !== String(atual).trim()) {
        patch[campo] = valor;
        mudados++;
      }
    };

    setIfChanged('razao_social', (data.razao_social || '').trim() as Empresa['razao_social']);
    setIfChanged('apelido', (data.nome_fantasia || '').trim() as Empresa['apelido']);
    setIfChanged('data_abertura', (data.data_abertura || '').trim() as Empresa['data_abertura']);
    setIfChanged('estado', (data.estado || '').trim() as Empresa['estado']);
    setIfChanged('cidade', (data.cidade || '').trim() as Empresa['cidade']);
    setIfChanged('bairro', (data.bairro || '').trim() as Empresa['bairro']);
    setIfChanged('logradouro', (data.logradouro || '').trim() as Empresa['logradouro']);
    setIfChanged('numero', digitsOnly(data.numero) as Empresa['numero']);
    setIfChanged('cep', formatCep(data.cep) as Empresa['cep']);
    setIfChanged('email', (data.email || '').trim() as Empresa['email']);
    setIfChanged('telefone', (data.telefone || '').trim() as Empresa['telefone']);

    if (mudados === 0) return 0;
    await atualizarEmpresa(empresa.id, patch);
    return mudados;
  };

  const iniciar = async () => {
    if (rodandoRef.current) return;
    rodandoRef.current = true;
    cancelarRef.current = false;
    setRodando(true);
    setResumo({ sucesso: 0, erro: 0 });

    const idsPendentes: number[] = [];
    items.forEach((it, i) => {
      if (it.status === 'pendente') idsPendentes.push(i);
    });

    let okCount = 0;
    let errCount = 0;

    for (let k = 0; k < idsPendentes.length; k++) {
      if (cancelarRef.current) break;
      const idx = idsPendentes[k];
      setIndiceAtual(idx);
      atualizarItem(idx, { status: 'buscando', mensagem: undefined });

      const empresa = items[idx].empresa;
      const cnpj = digitsOnly(empresa.cnpj);

      try {
        const data = await api.consultarCnpj(cnpj);
        const camposAtualizados = await aplicarRetorno(empresa, data);
        atualizarItem(idx, {
          status: 'sucesso',
          mensagem: camposAtualizados === 0 ? 'Já estava atualizado' : `${camposAtualizados} campo(s) atualizado(s)`,
          camposAtualizados,
        });
        okCount++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Erro desconhecido';
        atualizarItem(idx, { status: 'erro', mensagem: msg });
        errCount++;

        if (/limite/i.test(msg) || /429/.test(msg)) {
          atualizarItem(idx, { mensagem: `${msg} — aguardando 60s para retomar` });
          await sleep(RATE_LIMIT_BACKOFF_MS);
        }
      }

      setResumo({ sucesso: okCount, erro: errCount });

      if (k < idsPendentes.length - 1) {
        await sleep(DELAY_MS);
      }
    }

    if (cancelarRef.current) {
      setItems((prev) =>
        prev.map((it) => (it.status === 'pendente' ? { ...it, status: 'cancelada' } : it))
      );
    }

    setRodando(false);
    rodandoRef.current = false;
    setIndiceAtual(-1);
  };

  const cancelar = () => {
    cancelarRef.current = true;
  };

  const fechar = () => {
    if (rodando) {
      cancelarRef.current = true;
    }
    onClose();
  };

  return (
    <ModalBase isOpen onClose={fechar} labelledBy="encontrar-cnpjs-titulo" dialogClassName="w-full max-w-3xl rounded-2xl bg-white shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center shadow-md">
            <Search className="text-white" size={18} />
          </div>
          <div>
            <h2 id="encontrar-cnpjs-titulo" className="text-lg font-bold text-gray-900">Encontrar CNPJs</h2>
            <p className="text-xs text-gray-500">
              Mostra empresas com CNPJ que estão sem endereço completo. Consulta a Receita ({DELAY_MS / 1000}s entre cada uma) e preenche o cadastro.
            </p>
          </div>
        </div>
        <button
          onClick={fechar}
          className="rounded-lg p-2 hover:bg-gray-100 transition"
          title="Fechar"
        >
          <X size={20} className="text-gray-500" />
        </button>
      </div>

      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 text-sm">
            <span className="rounded-lg bg-white border border-gray-200 px-3 py-1.5 font-semibold text-gray-700">
              <span className="text-gray-500">Total:</span> <span className="text-gray-900">{items.length}</span>
            </span>
            <span className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-1.5 font-semibold text-emerald-700">
              <Check size={14} className="inline -mt-0.5 mr-1" />{totalSucesso}
            </span>
            <span className="rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 font-semibold text-red-700">
              <AlertTriangle size={14} className="inline -mt-0.5 mr-1" />{totalErro}
            </span>
            <span className="rounded-lg bg-cyan-50 border border-cyan-200 px-3 py-1.5 font-semibold text-cyan-700">
              {totalPendente} pendente(s)
            </span>
          </div>

          <div className="flex items-center gap-2">
            {!rodando ? (
              <button
                onClick={iniciar}
                disabled={items.length === 0 || totalPendente === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-500 text-white px-4 py-2 text-sm font-bold hover:from-cyan-700 hover:to-teal-600 shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                <Play size={16} />
                {totalSucesso + totalErro > 0 ? 'Continuar' : 'Iniciar busca'}
              </button>
            ) : (
              <button
                onClick={cancelar}
                className="inline-flex items-center gap-2 rounded-xl bg-red-50 text-red-700 px-4 py-2 text-sm font-bold hover:bg-red-100 transition"
              >
                <Square size={16} />
                Parar
              </button>
            )}
          </div>
        </div>

        {(rodando || totalProcessado > 0) && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs font-semibold text-gray-500 mb-1">
              <span>Progresso</span>
              <span>{progresso}%</span>
            </div>
            <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-teal-500 transition-all"
                style={{ width: `${progresso}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-3">
        {items.length === 0 ? (
          <div className="text-center text-gray-400 py-10 text-sm">
            Todas as empresas com CNPJ já têm endereço preenchido. Nada a buscar.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((it, idx) => (
              <li
                key={it.empresa.id}
                className={`py-2.5 flex items-center gap-3 ${idx === indiceAtual ? 'bg-cyan-50 -mx-6 px-6' : ''}`}
              >
                <div className="shrink-0 w-6">
                  {it.status === 'buscando' && <Loader2 className="animate-spin text-cyan-600" size={18} />}
                  {it.status === 'sucesso' && <Check className="text-emerald-600" size={18} />}
                  {it.status === 'erro' && <AlertTriangle className="text-red-500" size={18} />}
                  {it.status === 'cancelada' && <X className="text-gray-400" size={18} />}
                  {it.status === 'pendente' && <div className="h-2 w-2 rounded-full bg-gray-300" />}
                </div>
                <span className="shrink-0 rounded-md bg-gradient-to-r from-teal-500 to-cyan-500 text-white px-2 py-0.5 text-[11px] font-bold">
                  {it.empresa.codigo}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-gray-900 truncate">
                    {it.empresa.razao_social || it.empresa.apelido || '(sem nome)'}
                  </div>
                  <div className="text-[11px] text-gray-500 font-mono">
                    {formatarDocumento(it.empresa.cnpj || '', 'CNPJ')}
                  </div>
                </div>
                {it.mensagem && (
                  <div
                    className={`text-[11px] font-semibold text-right max-w-[40%] truncate ${
                      it.status === 'erro'
                        ? 'text-red-600'
                        : it.status === 'sucesso'
                          ? 'text-emerald-600'
                          : 'text-gray-500'
                    }`}
                    title={it.mensagem}
                  >
                    {it.mensagem}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
        <div className="text-xs text-gray-500">
          {rodando ? (
            <span>Buscando... {totalProcessado}/{items.length} processadas. Sucesso: {resumo.sucesso} · Erros: {resumo.erro}</span>
          ) : (
            <span>{totalSucesso + totalErro > 0 ? `Concluído: ${resumo.sucesso} sucesso(s), ${resumo.erro} erro(s).` : 'Empresas com CNPJ que estão sem cidade, estado, logradouro ou CEP completo.'}</span>
          )}
        </div>
        <button
          onClick={fechar}
          className="rounded-lg px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-100 transition"
        >
          {rodando ? 'Fechar (vai parar)' : 'Fechar'}
        </button>
      </div>
    </ModalBase>
  );
}
