import type { ToastItem } from "../lib/types";

export function Toasts({ items }: { items: ToastItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span className="toast-dot" />
          {t.message}
        </div>
      ))}
    </div>
  );
}
