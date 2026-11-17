import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react-native';
import { color, font, radius } from '../theme';
import { matchingExercises } from './exercisePickerOptions';
import type { ExercisePickerProps } from './exercisePickerOptions';

export function ExercisePicker({ label, options, value, onChange, disabled }: ExercisePickerProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState({ above: false, left: 0, edge: 0, width: 0, height: 0 });
  const expanded = open && !disabled;
  const selected = options.find((option) => option.value === value);
  const matches = expanded ? matchingExercises(options, query ?? '') : [];
  const activeId = matches[active] ? id + '-option-' + active : undefined;

  function dismiss() {
    setOpen(false);
    setQuery(null);
    setActive(-1);
  }

  function choose(option: (typeof options)[number]) {
    dismiss();
    onChange(option.value);
    input.current?.focus();
  }

  useLayoutEffect(() => {
    if (!expanded) return;
    function place(event?: Event) {
      if (event?.target instanceof Node && popup.current?.contains(event.target)) return;
      const bounds = input.current?.getBoundingClientRect();
      if (!bounds) return;
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const bottom = top + (viewport?.height ?? window.innerHeight);
      const below = bottom - bounds.bottom - 8;
      const above = bounds.top - top - 8;
      const openAbove = below < 200 && above > below;
      setPosition({
        above: openAbove, left: bounds.left, width: bounds.width,
        edge: openAbove ? window.innerHeight - bounds.top + 5 : bounds.bottom + 5,
        height: Math.max(46, Math.min(240, openAbove ? above : below)),
      });
    }
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [expanded]);

  useEffect(() => {
    if (!activeId) return;
    const list = popup.current;
    const row = document.getElementById(activeId);
    if (!list || !row) return;
    const bounds = row.getBoundingClientRect();
    const viewport = list.getBoundingClientRect();
    if (bounds.bottom > viewport.bottom) list.scrollTop += bounds.bottom - viewport.bottom;
    if (bounds.top < viewport.top) list.scrollTop -= viewport.top - bounds.top;
  }, [activeId]);

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!expanded) {
        setOpen(true);
        setActive(event.key === 'ArrowDown' ? 0 : options.length - 1);
      } else if (matches.length) {
        setActive(event.key === 'ArrowDown' ? Math.min(active + 1, matches.length - 1)
          : active < 0 ? matches.length - 1 : Math.max(active - 1, 0));
      }
    } else if (expanded && event.key === 'Enter') {
      event.preventDefault();
      if (matches[active]) choose(matches[active]);
    } else if (expanded && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    }
  }

  return <div ref={root} style={{ display: 'grid', gap: 7 }}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) dismiss(); }}>
    <label htmlFor={id} style={{ font: `12px ${font.semibold}`, color: color.text }}>{label}</label>
    <div style={{ position: 'relative' }}>
      <input ref={input} id={id} type="text" role="combobox" autoComplete="off" spellCheck={false}
        aria-expanded={expanded} aria-autocomplete="list" aria-controls={expanded ? id + '-list' : undefined}
        aria-activedescendant={activeId} disabled={disabled}
        placeholder="Type or choose an exercise"
        value={query ?? selected?.label ?? ''}
        onFocus={(event) => event.currentTarget.select()}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          setOpen(true);
          setQuery(event.currentTarget.value);
          setActive(0);
          if (popup.current) popup.current.scrollTop = 0;
        }}
        onKeyDown={handleKey}
        style={{ width: '100%', boxSizing: 'border-box', height: 43, border: `1px solid ${color.control}`,
          borderRadius: radius.control, padding: '0 40px 0 11px', background: color.surface, color: color.text,
          font: `16px ${font.regular}` }} />
      <button type="button" tabIndex={-1} aria-label={expanded ? 'Hide exercises' : 'Show exercises'}
        aria-expanded={expanded} aria-controls={expanded ? id + '-list' : undefined} disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          input.current?.focus();
          if (expanded) dismiss();
          else setOpen(true);
        }}
        style={{ position: 'absolute', inset: '1px 1px 1px auto', width: 39, background: 'none',
          border: 0, borderRadius: radius.control, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
        <ChevronDown aria-hidden size={17} color={color.forest} />
      </button>
    </div>
    {expanded && createPortal(<div ref={popup} style={{ position: 'fixed', zIndex: 10, boxSizing: 'border-box',
      left: position.left, width: position.width, ...(position.above ? { bottom: position.edge } : { top: position.edge }),
      maxHeight: position.height, overflowY: 'auto', overscrollBehavior: 'contain',
      background: color.surface, border: `1px solid ${color.control}`, borderRadius: radius.control,
      boxShadow: '0 5px 18px #102e1d26' }}>
      <div id={id + '-list'} role="listbox" aria-label={label} onMouseDown={(event) => event.preventDefault()}>
        {matches.map((option, index) => <div key={option.value} id={id + '-option-' + index}
          role="option" aria-selected={active < 0 ? option.value === value : index === active}
          onMouseMove={() => setActive(index)} onClick={() => choose(option)}
          style={{ padding: '10px 11px', minHeight: 22, font: `14px/1.45 ${font.regular}`, color: color.text,
            background: index === active || (active < 0 && option.value === value) ? color.tint : color.surface, cursor: 'pointer' }}>
          {option.label}{option.detail && <span style={{ color: color.muted }}> · {option.detail}</span>}
        </div>)}
      </div>
      {!matches.length && <div role="status" style={{ padding: 11, font: `14px ${font.regular}`, color: color.muted }}>
        No matching exercises
      </div>}
    </div>, root.current?.closest('dialog') ?? document.body)}
  </div>;
}
