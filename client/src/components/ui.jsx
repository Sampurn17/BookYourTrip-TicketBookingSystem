import { useEffect, useRef } from 'react';
import { FiX, FiInbox } from 'react-icons/fi';

export function Modal({ title, onClose, children, wide = false, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input, select, textarea, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <FiX size={20} />
          </button>
        </div>
        {children}
        {footer && <div className="modal-actions">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon: Icon = FiInbox, title, children, action }) {
  return (
    <div className="empty">
      <Icon size={34} aria-hidden="true" />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export const Spinner = () => <div className="spinner" role="status" aria-label="Loading" />;

export function Bars({ data, valueKey, labelKey, format = (v) => v, alt = false, max }) {
  const top = max ?? Math.max(1, ...data.map((d) => d[valueKey]));
  return (
    <div className="bars">
      {data.map((d) => (
        <div key={d[labelKey]} className={`bar${alt ? ' alt' : ''}`} title={`${d[labelKey]}: ${format(d[valueKey])}`}>
          <b>{format(d[valueKey])}</b>
          <div className="bar-track">
            <i style={{ height: `${Math.max(2, (d[valueKey] / top) * 100)}%` }} />
          </div>
          <span>{d.short || d[labelKey]}</span>
        </div>
      ))}
    </div>
  );
}

export function Meter({ value }) {
  const cls = value >= 90 ? 'full' : value >= 70 ? 'high' : '';
  return (
    <div className={`meter ${cls}`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

const STATUS_BADGE = {
  confirmed: 'ok',
  active: 'ok',
  scheduled: 'ok',
  pending: 'warn',
  suspended: 'warn',
  cancelled: 'bad',
  discontinued: 'bad',
};
export const StatusBadge = ({ status }) => <span className={`badge ${STATUS_BADGE[status] || 'neutral'}`}>{status}</span>;
