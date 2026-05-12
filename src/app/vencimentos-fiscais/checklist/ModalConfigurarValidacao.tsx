'use client';

import React, { useEffect, useState } from 'react';
import { Check, FileText, Loader2, Plus, Trash2, Upload, X } from 'lucide-react';
import ModalBase from '@/app/components/ModalBase';
import { extrairTextoPdf } from '@/app/utils/extrairTextoPdf';
import { sugerirPalavrasChave, type SugestaoPalavraChave } from '@/app/utils/sugerirPalavrasChave';
import {
  fetchChecklistValidacaoKeywords,
  upsertChecklistValidacaoKeyword,
} from '@/lib/db';
import type { UUID } from '@/app/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  obrigacaoNome: string;       // ex: "ICMS", "SPED ICMS/IPI"
  currentUserId: UUID | null;
  onSaved?: () => void;        // callback pra recarregar keywords no checklist
}

export default function ModalConfigurarValidacao({
  isOpen,
  onClose,
  obrigacaoNome,
  currentUserId,
  onSaved,
}: Props) {
  const [palavras, setPalavras] = useState<string[]>([]);
  const [novaPalavra, setNovaPalavra] = useState('');
  const [sugestoes, setSugestoes] = useState<SugestaoPalavraChave[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [analisandoPdf, setAnalisandoPdf] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  // Carrega palavras existentes quando o modal abre
  useEffect(() => {
    if (!isOpen) return;
    setErroSalvar(null);
    setSugestoes([]);
    setCarregando(true);
    fetchChecklistValidacaoKeywords()
      .then((todas) => {
        const atual = todas.find((k) => k.obrigacaoNome === obrigacaoNome);
        setPalavras(atual?.palavrasChave ?? []);
      })
      .catch((err) => {
        console.error('[ModalConfigurarValidacao] erro ao carregar:', err);
        setPalavras([]);
      })
      .finally(() => setCarregando(false));
  }, [isOpen, obrigacaoNome]);

  function adicionarPalavra(termo: string) {
    const t = termo.trim();
    if (!t) return;
    const existe = palavras.some((p) => p.trim().toLowerCase() === t.toLowerCase());
    if (existe) return;
    setPalavras((prev) => [...prev, t]);
  }

  function removerPalavra(idx: number) {
    setPalavras((prev) => prev.filter((_, i) => i !== idx));
  }

  async function analisarPdf(file: File) {
    setAnalisandoPdf(true);
    try {
      const { texto } = await extrairTextoPdf(file);
      const sug = sugerirPalavrasChave(texto, 10);
      setSugestoes(sug);
    } catch (err) {
      console.error('[ModalConfigurarValidacao] erro ao analisar PDF:', err);
      alert('Não foi possível ler esse PDF. Pode ser um PDF de imagem (scanneado) ou protegido.');
    } finally {
      setAnalisandoPdf(false);
    }
  }

  async function salvar() {
    setSalvando(true);
    setErroSalvar(null);
    try {
      await upsertChecklistValidacaoKeyword({
        obrigacaoNome,
        palavrasChave: palavras.map((p) => p.trim()).filter((p) => p.length > 0),
        userId: currentUserId,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro inesperado';
      setErroSalvar(msg);
    } finally {
      setSalvando(false);
    }
  }

  function jaSelecionada(termo: string): boolean {
    return palavras.some((p) => p.trim().toLowerCase() === termo.trim().toLowerCase());
  }

  return (
    <ModalBase isOpen={isOpen} onClose={onClose} dialogClassName="max-w-2xl">
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Validação de upload
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              <strong className="text-cyan-700 dark:text-cyan-400">{obrigacaoNome}</strong> — palavras que precisam aparecer no PDF
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        {carregando ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <>
            {/* Subir PDF exemplo */}
            <div className="mt-5 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                Subir PDF exemplo (opcional)
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                O sistema vai sugerir palavras-chave automaticamente a partir do texto do PDF.
              </p>
              <label
                className={`mt-2 inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 ${
                  analisandoPdf ? 'pointer-events-none opacity-60' : ''
                }`}
              >
                {analisandoPdf ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Analisando...
                  </>
                ) : (
                  <>
                    <Upload size={14} /> Escolher PDF exemplo
                  </>
                )}
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  disabled={analisandoPdf}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void analisarPdf(file);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>

            {/* Sugestões */}
            {sugestoes.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  Sugestões do PDF — toque pra adicionar:
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {sugestoes.map((s) => {
                    const ativo = jaSelecionada(s.termo);
                    return (
                      <button
                        key={s.termo}
                        onClick={() => adicionarPalavra(s.termo)}
                        disabled={ativo}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                          ativo
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : 'border-cyan-300 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300'
                        }`}
                        title={`Fonte: ${s.fonte} · aparece ${s.ocorrencias}x`}
                      >
                        {ativo ? <Check size={11} /> : <Plus size={11} />}
                        {s.termo}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Palavras-chave atuais */}
            <div className="mt-5">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                Palavras-chave salvas:
              </p>
              {palavras.length === 0 ? (
                <p className="mt-2 rounded-md border border-dashed border-slate-300 bg-white p-3 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900">
                  Nenhuma palavra-chave ainda. Sem palavras, o sistema permite qualquer upload (sem validação).
                </p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {palavras.map((p, idx) => (
                    <li
                      key={`${p}-${idx}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300 bg-cyan-50 px-2.5 py-1 text-xs text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200"
                    >
                      <span>{p}</span>
                      <button
                        onClick={() => removerPalavra(idx)}
                        className="rounded p-0.5 text-cyan-700 hover:bg-cyan-200 dark:text-cyan-300 dark:hover:bg-cyan-900"
                        aria-label={`Remover ${p}`}
                      >
                        <Trash2 size={11} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Adicionar manualmente */}
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={novaPalavra}
                  onChange={(e) => setNovaPalavra(e.target.value)}
                  placeholder="Digitar palavra/frase e Enter"
                  className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 dark:border-slate-700 dark:bg-slate-950"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      adicionarPalavra(novaPalavra);
                      setNovaPalavra('');
                    }
                  }}
                />
                <button
                  onClick={() => {
                    adicionarPalavra(novaPalavra);
                    setNovaPalavra('');
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700"
                >
                  <Plus size={12} /> Adicionar
                </button>
              </div>
            </div>

            {/* Dica */}
            <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <strong className="font-semibold">💡 Dica:</strong> escolhe 2-3 palavras/siglas que aparecem <em>só</em> nesse tipo de guia (ex: <code>ICMS</code>, <code>GIA</code>). Evita palavras genéricas como "guia" ou "imposto" que aparecem em várias.
            </div>

            {erroSalvar && (
              <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                <strong>Falha ao salvar:</strong> {erroSalvar}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
              <button
                onClick={onClose}
                disabled={salvando}
                className="rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                onClick={salvar}
                disabled={salvando}
                className="inline-flex items-center gap-2 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-60"
              >
                {salvando ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                Salvar palavras-chave
              </button>
            </div>
          </>
        )}
      </div>
    </ModalBase>
  );
}
