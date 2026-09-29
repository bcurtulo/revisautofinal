import { useState, useRef, useEffect, useId } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  required?: boolean;
  className?: string;
  disabled?: boolean;
}

/**
 * Select com glassmorphism.
 *
 * O <select> nativo não suporta backdrop-filter, então o painel
 * seria pintado sólido quebrando o visual glass. Esta versão
 * é um botão + painel absoluto — totalmente estilizável.
 *
 * Acessibilidade: aria-haspopup, aria-expanded, aria-activedescendant,
 * navegação por teclado (↑↓ Enter Esc Tab), foco gerenciado.
 */
export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = 'Selecionar',
  required,
  className = '',
  disabled = false,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const selected = options.find(o => o.value === value);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        panelRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll da opção focada para dentro da view
  useEffect(() => {
    if (!open || focusedIndex < 0 || !panelRef.current) return;
    const el = panelRef.current.querySelector<HTMLElement>(
      `[data-index="${focusedIndex}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex, open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
        setFocusedIndex(options.findIndex(o => o.value === value) || 0);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(i => Math.min(i + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedIndex >= 0) {
          onChange(options[focusedIndex].value);
          setOpen(false);
          triggerRef.current?.focus();
        }
        break;
      case 'Escape':
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  const chevron = (
    <svg
      className="chevron w-4 h-4 text-[#9aa0a8]"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return (
    <div className={`custom-select-wrapper ${className}`}>
      {/* Campo oculto para participar do submit nativo de forms */}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', height: 0 }}
          required={required}
          value={value}
          onChange={() => {}}
        />
      )}

      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-activedescendant={focusedIndex >= 0 ? `${id}-opt-${focusedIndex}` : undefined}
        data-open={open}
        disabled={disabled}
        className="custom-select-trigger"
        onClick={() => {
          if (disabled) return;
          setOpen(o => !o);
          if (!open) setFocusedIndex(options.findIndex(o => o.value === value));
        }}
        onKeyDown={handleKeyDown}
      >
        <span style={{ color: selected ? 'var(--color-heading)' : 'var(--color-revis-muted)' }}>
          {selected ? selected.label : placeholder}
        </span>
        {chevron}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={`${id}-panel`}
          role="listbox"
          aria-label={placeholder}
          className="custom-select-panel scrollbar-hide"
        >
          {options.map((opt, i) => (
            <div
              key={opt.value}
              id={`${id}-opt-${i}`}
              data-index={i}
              data-selected={opt.value === value}
              role="option"
              aria-selected={opt.value === value}
              className="custom-select-option"
              onMouseDown={e => {
                e.preventDefault(); // evita blur no trigger antes do click
                onChange(opt.value);
                setOpen(false);
                triggerRef.current?.focus();
              }}
              onMouseEnter={() => setFocusedIndex(i)}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default CustomSelect;
