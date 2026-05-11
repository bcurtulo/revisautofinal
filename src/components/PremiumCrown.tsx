import React from 'react';
import { Crown } from 'lucide-react';

const sizeClasses = {
  xs: 'w-3 h-3',
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-10 h-10',
} as const;

export type PremiumCrownSize = keyof typeof sizeClasses;

/**
 * Coroa Plus/Premium — tooltip ao hover + opcional clique direto para o modal de planos.
 */
export function PremiumCrown({
  tooltip,
  onOpenPlans,
  size = 'md',
  className,
  decorative = false,
}: {
  tooltip: string;
  onOpenPlans?: () => void;
  size?: PremiumCrownSize;
  className?: string;
  /** true = sem ação ao clique (ex.: já está dentro de um botão que trata navegação) */
  decorative?: boolean;
}) {
  const dim = sizeClasses[size];
  const iconClass = `${dim} text-amber-400 fill-amber-400 shrink-0 drop-shadow-[0_0_10px_rgba(251,191,36,0.28)]`;

  const tooltipNode = (
    <span className="pointer-events-none absolute left-1/2 bottom-full mb-2 z-[140] -translate-x-1/2 rounded-md border border-white/15 bg-black px-2.5 py-1.5 text-[10px] font-semibold tracking-tight text-white opacity-0 shadow-xl transition-opacity duration-150 whitespace-nowrap group-hover/pcor:opacity-100 group-focus-within/pcor:opacity-100">
      {tooltip}
    </span>
  );

  const icon = <Crown className={iconClass} aria-hidden />;

  if (decorative || !onOpenPlans) {
    return (
      <span className={`group/pcor relative inline-flex items-center justify-center ${className ?? ''}`}>
        {icon}
        {tooltipNode}
        <span className="sr-only">{tooltip}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`group/pcor relative inline-flex items-center justify-center rounded-lg p-0.5 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-amber-400/60 ${className ?? ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onOpenPlans();
      }}
      aria-label={tooltip}
    >
      {icon}
      {tooltipNode}
    </button>
  );
}
