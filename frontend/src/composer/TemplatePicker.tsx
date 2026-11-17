import {
  supportedTemplatesFor,
  TEMPLATES,
  TEMPLATE_CATEGORIES,
  type TemplateCategory,
  type TemplateId,
} from '@rulebook/shared';

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  trading: 'Trading',
  personal: 'Personal',
  alert: 'Alerts (never move funds)',
};

export interface TemplatePickerProps {
  /** The chain whose supported templates are offered. */
  readonly chainId: number;
  readonly selected: TemplateId;
  readonly onSelect: (template: TemplateId) => void;
}

/**
 * Offers the templates the selected chain can express, grouped by category in a native select
 * (so arrow keys, Enter, and screen readers all work), and prints the manifest's caveat for the
 * templates that need one (#2, #6, #9, #12). Caveat text comes from the manifest, so the honesty
 * copy cannot drift from the catalog.
 */
export function TemplatePicker({ chainId, selected, onSelect }: TemplatePickerProps) {
  const supported = supportedTemplatesFor(chainId);
  const available = TEMPLATES.filter((template) => supported.includes(template.id));
  const caveats = available.filter((template) => template.caveat);

  return (
    <div className="space-y-2">
      <label htmlFor="template" className="text-xs uppercase tracking-wide text-ink-muted">
        Rule type
      </label>
      <select
        id="template"
        value={selected}
        onChange={(event) => onSelect(Number(event.target.value) as TemplateId)}
        className="w-full rounded border border-border bg-surface-raised px-3 py-2 text-sm text-ink"
      >
        {TEMPLATE_CATEGORIES.map((category) => {
          const templates = available.filter((template) => template.category === category);
          if (templates.length === 0) return null;
          return (
            <optgroup key={category} label={CATEGORY_LABELS[category]}>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>

      {caveats.length > 0 ? (
        <ul aria-label="Template caveats" className="space-y-1">
          {caveats.map((template) => (
            <li
              key={template.id}
              data-caveat={template.id}
              className="text-[11px] leading-snug text-ink-muted"
            >
              <span className="font-medium text-ink">{template.name}: </span>
              {template.caveat}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
