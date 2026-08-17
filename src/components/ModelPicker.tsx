import { useMemo, useState } from "react";
import type { ModelOption } from "../lib/types";
import { SearchIcon } from "./icons";

interface ModelPickerProps {
  models: ModelOption[];
  selected: string[];
  onToggle: (slug: string) => void;
  onAll: () => void;
  onNone: () => void;
  error?: string;
  source?: string;
}

export function ModelPicker({ models, selected, onToggle, onAll, onNone, error, source }: ModelPickerProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) => m.slug.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q),
    );
  }, [models, query]);

  return (
    <div className="model-picker">
      <div className="model-box-head">
        <div className="model-search">
          {SearchIcon}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter models..."
            aria-label="Filter models"
          />
        </div>
        <button type="button" className="btn sm ghost" onClick={onAll}>
          All
        </button>
        <button type="button" className="btn sm ghost" onClick={onNone}>
          None
        </button>
      </div>
      <div className="model-list">
        {filtered.length === 0 && (
          <div className="model-empty">{error ?? (query ? "No models match the filter" : "No models")}</div>
        )}
        {filtered.map((m) => {
          const idx = selected.indexOf(m.slug);
          return (
            <label key={m.slug} className={`model-item${idx >= 0 ? " selected" : ""}`}>
              <input
                type="checkbox"
                aria-label={`Select model ${m.displayName}`}
                checked={idx >= 0}
                onChange={() => onToggle(m.slug)}
              />
              <span className="model-item-name" title={`${m.displayName} · ${m.slug}`}>
                {m.displayName} <em>{m.slug}</em>
              </span>
              {idx === 0 && <span className="badge live">Default</span>}
              {idx > 0 && <span className="model-item-order">#{idx + 1}</span>}
            </label>
          );
        })}
      </div>
      <div className="model-box-foot">
        {selected.length}/{models.length} selected · first selected is the default model · {source ?? "unknown source"}
      </div>
    </div>
  );
}
