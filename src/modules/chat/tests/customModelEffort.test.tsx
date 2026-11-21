import assert from 'node:assert/strict';

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { api } from '@/shared/api';
import ComposerModelMenu from '@/modules/chat/composer/ComposerModelMenu';
import ModelLibraryPanel from '@/modules/chat/modals/ModelLibraryPanel';
import { writeSelectedProvider } from '@/shared/selectedProvider';
import { resetUserPreferences } from '@/shared/userSettings';
import type {
  CustomProviderModelInput,
  LLMProvider,
  ProviderModelActions,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types';

/**
 * Custom models used to carry no effort metadata, so the composer hid its
 * Reasoning section for them (#1294). These tests pin both halves of the fix
 * on the client: the Model Library form declares effort levels (the ones the
 * catalog's `EFFORT_LEVELS` allows), and a catalog entry that carries them
 * drives the composer's effort options.
 */

const CUSTOM_CLAUDE_MODEL: ProviderModelOption = {
  value: 'my-custom-model',
  label: 'My Custom Model',
  recordId: 7,
  isCustom: true,
  effort: { default: 'high', values: [{ value: 'low' }, { value: 'high' }] },
};

const CATALOG: Partial<Record<LLMProvider, ProviderModelsDefinition>> = {
  claude: {
    OPTIONS: [
      {
        value: 'default',
        label: 'Default',
        isCustom: false,
        effort: {
          default: 'high',
          values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'max' }],
        },
      },
      {
        value: 'opus',
        label: 'Opus',
        isCustom: false,
        effort: {
          default: 'high',
          values: [{ value: 'low' }, { value: 'high' }, { value: 'xhigh' }, { value: 'max' }],
        },
      },
      CUSTOM_CLAUDE_MODEL,
    ],
    DEFAULT: 'default',
    EFFORT_LEVELS: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
  },
  cursor: {
    OPTIONS: [{ value: 'auto', label: 'Auto', isCustom: false }],
    DEFAULT: 'auto',
    EFFORT_LEVELS: [],
  },
  antigravity: {
    OPTIONS: [{
      value: 'gemini-pro-low',
      label: 'Gemini Pro',
      effort: {
        default: 'low',
        values: [{ value: 'low', modelId: 'gemini-pro-low' }, { value: 'high', modelId: 'gemini-pro-high' }],
      },
    }],
    DEFAULT: 'gemini-pro-low', EFFORT_LEVELS: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  // What OpenCode serves on a machine with only OpenCode Zen connected: none of
  // the visible built-in models declares effort, yet the provider supports it.
  opencode: {
    OPTIONS: [{ value: 'opencode/gpt-5.5', label: 'GPT 5.5', isCustom: false }],
    DEFAULT: 'opencode/gpt-5.5',
    EFFORT_LEVELS: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'thinking'],
  },
};

const okJson = (data: unknown) => Promise.resolve({
  ok: true,
  json: async () => data,
});

vi.mock('@/shared/api', () => ({
  api: {
    user: {
      preferences: () => okJson({ success: true, preferences: {} }),
      savePreferences: () => okJson({ success: true, preferences: {} }),
    },
    providers: {
      models: (provider: LLMProvider) => okJson({
        success: true,
        data: CATALOG[provider] ? { models: CATALOG[provider] } : null,
      }),
      capabilities: () => okJson({ success: true, data: null }),
      sessionActiveModel: vi.fn(() => okJson({ success: true, data: null })),
      setSessionActiveModel: vi.fn(() => okJson({ success: true, data: null })),
      setSessionActiveEffort: () => okJson({ success: true, data: null }),
    },
  },
}));

const createActions = () => {
  const created: Array<{ provider: LLMProvider; input: CustomProviderModelInput }> = [];
  const updated: Array<{ provider: LLMProvider; input: CustomProviderModelInput }> = [];
  const actions: ProviderModelActions = {
    create: async (provider, input) => {
      created.push({ provider, input });
    },
    update: async (provider, _existing, input) => {
      updated.push({ provider, input });
    },
    remove: async () => {},
    setCustomModelsOnly: async () => {},
  };
  return { actions, created, updated };
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetUserPreferences();
});

test('the model library declares effort levels for a new custom model', async () => {
  const { actions, created } = createActions();
  render(<ModelLibraryPanel initialProvider="claude" providerModelCatalog={CATALOG} actions={actions} />);

  // Every level the catalog allows is offered, in the server's order.
  const levelButtons = ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'].map((level) => (
    screen.getByRole('button', { name: level, pressed: false })
  ));
  assert.equal(levelButtons.length, 6);

  fireEvent.change(screen.getByLabelText('Model name'), { target: { value: 'Gateway Claude' } });
  fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'gateway-claude' } });
  // Ticked out of order on purpose: the payload follows the display order.
  fireEvent.click(screen.getByRole('button', { name: 'max' }));
  fireEvent.click(screen.getByRole('button', { name: 'low' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add model' }));

  await waitFor(() => assert.equal(created.length, 1));
  assert.deepEqual(created[0], {
    provider: 'claude',
    input: {
      model: 'Gateway Claude',
      id: 'gateway-claude',
      effort: { values: ['low', 'max'] },
    },
  });
});

test('editing a custom model keeps its default level and can clear its levels', async () => {
  const { actions, updated } = createActions();
  render(<ModelLibraryPanel initialProvider="claude" providerModelCatalog={CATALOG} actions={actions} />);

  screen.getByText('Reasoning: low · high');
  fireEvent.click(screen.getByRole('button', { name: 'Edit My Custom Model' }));
  screen.getByRole('button', { name: 'low', pressed: true });
  screen.getByRole('button', { name: 'high', pressed: true });

  fireEvent.click(screen.getByRole('button', { name: 'max' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => assert.equal(updated.length, 1));
  assert.deepEqual(updated[0]?.input.effort, { values: ['low', 'high', 'max'], default: 'high' });

  fireEvent.click(screen.getByRole('button', { name: 'Edit My Custom Model' }));
  fireEvent.click(screen.getByRole('button', { name: 'low' }));
  fireEvent.click(screen.getByRole('button', { name: 'high' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => assert.equal(updated.length, 2));
  assert.equal(updated[1]?.input.effort, null);
});

test('OpenCode offers its effort levels even when no visible built-in model declares any', async () => {
  const { actions, created } = createActions();
  render(<ModelLibraryPanel initialProvider="opencode" providerModelCatalog={CATALOG} actions={actions} />);

  screen.getByText('Reasoning levels');
  fireEvent.change(screen.getByLabelText('Model name'), { target: { value: 'Router model' } });
  fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'openrouter/router-model' } });
  fireEvent.click(screen.getByRole('button', { name: 'high' }));
  fireEvent.click(screen.getByRole('button', { name: 'none' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add model' }));

  await waitFor(() => assert.equal(created.length, 1));
  assert.deepEqual(created[0]?.input.effort, { values: ['none', 'high'] });
});

test('providers without effort support show no effort levels and send none', async () => {
  const { actions, created } = createActions();
  render(<ModelLibraryPanel initialProvider="cursor" providerModelCatalog={CATALOG} actions={actions} />);

  assert.equal(screen.queryByText('Reasoning levels'), null);
  fireEvent.change(screen.getByLabelText('Model name'), { target: { value: 'Cursor Custom' } });
  fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'cursor-custom' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add model' }));

  await waitFor(() => assert.equal(created.length, 1));
  assert.equal('effort' in (created[0]?.input ?? {}), false);
});

test('the composer offers exactly the declared levels for a selected custom model', async () => {
  localStorage.setItem('claude-model', 'my-custom-model');
  const { useChatProviderState } = await import('@/modules/chat/hooks/useChatProviderState');
  const { result } = renderHook(() => useChatProviderState({ selectedSession: null, selectedProject: null }));

  await waitFor(() => assert.equal(result.current.providerModelsLoading, false));
  assert.equal(result.current.provider, 'claude');
  assert.equal(result.current.currentProviderModel, 'my-custom-model');
  assert.deepEqual(result.current.currentProviderEffortOptions, [{ value: 'low' }, { value: 'high' }]);
});

test('an existing Antigravity session uses the effort from its model ID and saves a new native variant', async () => {
  vi.mocked(api.providers.sessionActiveModel).mockImplementationOnce(() => okJson({
    success: true, data: { model: 'gemini-pro-high', effort: 'low', source: 'session' },
  }) as ReturnType<typeof api.providers.sessionActiveModel>);
  const { useChatProviderState } = await import('@/modules/chat/hooks/useChatProviderState');
  const { result } = renderHook(() => useChatProviderState({
    selectedSession: { id: 'agy-session', __provider: 'antigravity' }, selectedProject: null,
  }));
  await waitFor(() => {
    assert.equal(result.current.providerModelsLoading, false);
    assert.equal(result.current.currentProviderModel, 'gemini-pro-high');
  });
  assert.equal(result.current.currentProviderEffort, 'high');
  assert.equal(result.current.currentProviderModelOptions.length, 1);

  await act(async () => {
    await result.current.selectProviderEffort('antigravity', 'low', 'agy-session');
  });

  assert.equal(result.current.currentProviderModel, 'gemini-pro-low');
  assert.equal(result.current.currentProviderEffort, 'low');
  assert.deepEqual(vi.mocked(api.providers.setSessionActiveModel).mock.calls, [
    ['antigravity', 'agy-session', 'gemini-pro-low'],
  ]);
});

test('an Antigravity browser default keeps its concrete model through catalog hydration', async () => {
  writeSelectedProvider('antigravity');
  localStorage.setItem('antigravity-model', 'gemini-pro-high');
  const { useChatProviderState } = await import('@/modules/chat/hooks/useChatProviderState');
  const { result } = renderHook(() => useChatProviderState({ selectedSession: null, selectedProject: null }));

  await waitFor(() => assert.equal(result.current.providerModelsLoading, false));
  assert.equal(result.current.currentProviderModel, 'gemini-pro-high');
  assert.equal(result.current.currentProviderEffort, 'high');
  assert.equal(localStorage.getItem('antigravity-model'), 'gemini-pro-high');
});

test('the Antigravity composer displays a family label and sends one effort selection', () => {
  const option = CATALOG.antigravity!.OPTIONS[0];
  const onSelectEffort = vi.fn();
  render(
    <ComposerModelMenu
      model="gemini-pro-high"
      modelOptions={[option]}
      modelsLoading={false}
      effort="high"
      effortOptions={option.effort!.values}
      onSelectEffort={onSelectEffort}
      onSelectModel={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Select model and reasoning effort' }));
  screen.getByText('Reasoning');
  assert.equal(screen.queryByRole('menuitemradio', { name: 'Default' }), null);
  screen.getByRole('menuitemradio', { name: 'high', checked: true });
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'low' }));
  assert.deepEqual(onSelectEffort.mock.calls, [['low']]);
});
