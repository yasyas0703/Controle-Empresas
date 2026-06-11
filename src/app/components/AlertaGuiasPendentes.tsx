'use client';

// Alerta no topo do app pra gerência: quantas guias NÃO foram enviadas
// (problemas + pendências de aprovação do envio automático). Aparece só pra
// admin/gerente, só quando há pendências, é dispensável (reaparece se o número
// mudar), e atualiza sozinho a cada 60s. Link direto pro painel de resolução.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, X } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';

const DISMISS_KEY = 'alerta-guias-pendentes-dispensado-total';

// ⚠️ MODO TESTE (PROVISÓRIO — espelha ALERTA_TESTE_SOMENTE_USER_ID em
// src/lib/alertasAutoEnvio.ts): enquanto o auto-envio está em teste, o alerta
// aparece SÓ pro usuário Testes (admin@), pra não assustar a equipe com
// pendências do teste. Coloque `null` pra voltar ao normal (admin/gerente).
const ALERTA_TESTE_SOMENTE_EMAIL: string | null = 'admin@triarcontabilidade.com.br';

export default function AlertaGuiasPendentes() {
  // Contagem vem do poll compartilhado do SistemaContext (visibility-gated) —
  // este componente não faz mais fetch próprio.
  const { canManage, authReady, guiasAutoContagem, currentUser } = useSistema();
  const problemas = guiasAutoContagem.problemasPendentes;
  const pendencias = guiasAutoContagem.pendenciasAprovacao;
  const [dispensadoNoTotal, setDispensadoNoTotal] = useState<number | null>(null);

  // Restaura a dispensa da sessão.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DISMISS_KEY);
      if (raw != null) setDispensadoNoTotal(Number(raw));
    } catch {
      // ignora
    }
  }, []);

  const total = problemas + pendencias;

  if (!authReady || !canManage || total === 0) return null;
  if (ALERTA_TESTE_SOMENTE_EMAIL && currentUser?.email?.toLowerCase() !== ALERTA_TESTE_SOMENTE_EMAIL) return null;
  // Dispensado pra ESTE total exato — se aparecer/sumir guia, o número muda e o alerta volta.
  if (dispensadoNoTotal === total) return null;

  const dispensar = () => {
    try { sessionStorage.setItem(DISMISS_KEY, String(total)); } catch { /* ignora */ }
    setDispensadoNoTotal(total);
  };

  return (
    <div className="mb-3 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm">
      <AlertTriangle size={18} className="shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1 text-amber-900">
        <span className="font-semibold">
          {total} {total === 1 ? 'guia não foi enviada' : 'guias não foram enviadas'}
        </span>{' '}
        <span className="text-amber-800">
          ({problemas} com problema{pendencias > 0 ? `, ${pendencias} aguardando aprovação` : ''})
        </span>
      </div>
      <Link
        href="/vencimentos-fiscais/auto-problemas"
        className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700"
      >
        Ver e resolver
      </Link>
      <button
        onClick={dispensar}
        aria-label="Dispensar aviso"
        className="shrink-0 text-amber-700 hover:text-amber-900"
      >
        <X size={16} />
      </button>
    </div>
  );
}
