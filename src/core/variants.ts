import type {
  ComponentDefinition,
  StyleRule,
  VariantAxes,
  VariantSelector,
} from './types';

// expand variant axes into the cartesian product of all combinations
export function enumerateVariants(axes: VariantAxes): VariantSelector[] {
  const keys = Object.keys(axes);

  return keys.reduce<VariantSelector[]>((acc, k) => {
    if (acc.length === 0) return axes[k]!.map((v) => ({ [k]: v }));
    return acc.flatMap((prev) => axes[k]!.map((v) => ({ ...prev, [k]: v })));
  }, []);
}

// merge all style rules whose `when` clause matches the selector
export function matchedBindings(
  ir: ComponentDefinition,
  sel: VariantSelector
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const rule of ir.styles) {
    if (Object.entries(rule.when).every(([k, v]) => sel[k] === v)) {
      Object.assign(out, rule.bindings);
    }
  }

  return out;
}

// a single conditional binding for one style prop
export interface ConditionalBinding {
  when: Record<string, string | boolean>;
  ref: string;
}

// group style rules by style prop, ordered most-specific-first with base rule last
export function collectBindingsByProp(
  styles: StyleRule[]
): Map<string, ConditionalBinding[]> {
  const byProp = new Map<string, ConditionalBinding[]>();

  for (const rule of styles) {
    for (const [prop, ref] of Object.entries(rule.bindings)) {
      if (!byProp.has(prop)) byProp.set(prop, []);
      byProp.get(prop)!.push({ when: rule.when, ref: ref! });
    }
  }

  for (const [, rules] of byProp) {
    rules.sort((a, b) => {
      const aKeys = Object.keys(a.when).length;
      const bKeys = Object.keys(b.when).length;
      return bKeys - aKeys;
    });
  }

  return byProp;
}
