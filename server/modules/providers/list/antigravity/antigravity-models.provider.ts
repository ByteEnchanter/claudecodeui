import type {
  IProviderModels,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderModelOption,
} from '@/shared/index.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readAntigravityEffortVariant,
  resolveConfiguredCliExecutable,
  runProviderCliCommand,
} from '@/shared/index.js';

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Shows adjustable families once while retaining every account-available CLI model ID. */
function groupAntigravityModels(options: ProviderModelOption[]): ProviderModelOption[] {
  const variantsByFamily = new Map<string, Map<string, string>>();
  for (const option of options) {
    const variant = readAntigravityEffortVariant(option.value);
    if (!variant) continue;
    const variants = variantsByFamily.get(variant.family) ?? new Map<string, string>();
    variants.set(variant.effort, option.value);
    variantsByFamily.set(variant.family, variants);
  }

  const groupedFamilies = new Set<string>();
  return options.flatMap((option) => {
    const variant = readAntigravityEffortVariant(option.value);
    if (!variant) return [option];
    const variants = variantsByFamily.get(variant.family);
    if (!variants || variants.size < 2) return [option];
    if (groupedFamilies.has(variant.family)) return [];
    groupedFamilies.add(variant.family);

    // Keep the first native ID as the family's default so stored model IDs
    // and callers that choose a model without an effort remain valid.
    return [{
      ...option,
      label: option.label === option.value
        ? variant.family
        : option.label.replace(/\s*\((low|medium|high|xhigh|max)\)\s*$/i, ''),
      effort: {
        default: variant.effort,
        values: EFFORT_LEVELS.flatMap((value) => {
          const modelId = variants.get(value);
          return modelId ? [{ value, modelId }] : [];
        }),
      },
    }];
  });
}

/** Used by AntigravityProviderModels and its tests when live discovery is unavailable; not an entitlement check. */
export const ANTIGRAVITY_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: groupAntigravityModels([
    {
      value: 'gemini-3.8-flash-medium',
      label: 'Gemini 3.8 Flash (Medium)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'gemini-3.8-flash-high',
      label: 'Gemini 3.8 Flash (High)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'gemini-3.8-flash-low',
      label: 'Gemini 3.8 Flash (Low)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'gemini-3.7-flash-high',
      label: 'Gemini 3.7 Flash (High)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'gemini-3.7-flash-medium',
      label: 'Gemini 3.7 Flash (Medium)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'gemini-3.7-flash-low',
      label: 'Gemini 3.7 Flash (Low)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'gemini-3.6-flash-high',
      label: 'Gemini 3.6 Flash (High)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'gemini-3.6-flash-medium',
      label: 'Gemini 3.6 Flash (Medium)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'gemini-3.6-flash-low',
      label: 'Gemini 3.6 Flash (Low)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'gemini-3.1-pro-high',
      label: 'Gemini 3.1 Pro (High)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'gemini-3.1-pro-low',
      label: 'Gemini 3.1 Pro (Low)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6 (Thinking)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'claude-opus-4-6-thinking',
      label: 'Claude Opus 4.6 (Thinking)',
      description: 'Antigravity CLI model',
    },
    {
      value: 'gpt-oss-120b-medium',
      label: 'GPT-OSS 120B (Medium)',
      description: 'Antigravity CLI model',
    },
  ]),
  DEFAULT: 'gemini-3.8-flash-medium',
};

const MODELS_TIMEOUT_MS = 20_000;

/** Used by AntigravityProviderModels and its tests to preserve the native account-specific model list. */
export const parseAntigravityModelsStdout = (stdout: string): ProviderModelsDefinition => {
  const models = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [modelId, displayName] = line.split('\t', 2);
      return {
        value: modelId,
        label: displayName?.trim() || modelId,
        description: 'Antigravity CLI model',
      };
    });

  if (models.length === 0) {
    return ANTIGRAVITY_FALLBACK_MODELS;
  }

  return {
    OPTIONS: groupAntigravityModels(models),
    DEFAULT: models[0].value,
  };
};

/** Used by AntigravityProvider to query the current account's native model catalog. */
export class AntigravityProviderModels implements IProviderModels {
  /** Queries `agy models`, falling back to a stable catalog on probe failures. */
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const result = await runProviderCliCommand(
      resolveConfiguredCliExecutable(process.env.AGY_CLI_PATH, 'agy'),
      ['models'],
      {
        timeoutMs: MODELS_TIMEOUT_MS,
      },
    );

    if (result.error || result.exitCode !== 0) {
      return ANTIGRAVITY_FALLBACK_MODELS;
    }

    return parseAntigravityModelsStdout(result.stdout || '');
  }

  /** Resolves the default active model from the current AGY catalog. */
  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
