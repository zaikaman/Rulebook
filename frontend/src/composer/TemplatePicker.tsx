import { InformationCircleIcon, Layers01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
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
 * and shows the selected template's caveat from the manifest when it has one.
 */
export function TemplatePicker({ chainId, selected, onSelect }: TemplatePickerProps) {
  const supported = supportedTemplatesFor(chainId);
  const available = TEMPLATES.filter((template) => supported.includes(template.id));
  const caveat = available.find((template) => template.id === selected)?.caveat;

  return (
    <div className="rule-composer__template">
      <div className="rule-composer__template-row">
        <label htmlFor="template">
          <HugeiconsIcon icon={Layers01Icon} size={17} aria-hidden="true" />
          Rule type
        </label>
        <span className="rule-composer__select rule-composer__select--template">
          <select
            id="template"
            value={selected}
            onChange={(event) => onSelect(Number(event.target.value) as TemplateId)}
            aria-describedby={caveat ? 'template-caveat' : undefined}
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
        </span>
      </div>
      {caveat ? (
        <p id="template-caveat" data-caveat={selected} className="rule-composer__note">
          <HugeiconsIcon icon={InformationCircleIcon} size={16} aria-hidden="true" />
          <span>{caveat}</span>
        </p>
      ) : null}
    </div>
  );
}
