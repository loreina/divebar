import type {
  ComponentDefinition,
  FrameworkTarget,
  TokenSet,
} from '../core/types';

// theme hook + import path passed to adapters that need runtime theming
export interface ThemeConfig {
  hook: string;
  import: string;
}

// adapter that renders code from ir and parses code back to ir
export interface ComponentAdapter {
  target: FrameworkTarget;
  render(
    ir: ComponentDefinition,
    tokens: TokenSet,
    themeConfig?: ThemeConfig
  ): string;
  parse(code: string): ComponentDefinition;
}

// per-project figma adapter config (registry-level)
export interface FigmaConfig {
  tokenPathSeparator?: string;
}

// adapter that emits figma plugin api scripts for components and tokens
export interface FigmaScriptAdapter {
  renderComponent(
    ir: ComponentDefinition,
    tokens: TokenSet,
    config?: FigmaConfig
  ): string;
  renderTokens(tokens: TokenSet, config?: FigmaConfig): string;
}
