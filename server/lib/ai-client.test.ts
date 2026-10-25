import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicSdkClient } from './ai-client.js';

// ---------------------------------------------------------------------------
// Mock @anthropic-ai/sdk at the module level.
// The mock captures constructor options and messages.create arguments so tests
// can assert on SDK-level details invisible through the AnthropicClient interface.
// ---------------------------------------------------------------------------
const mockMessagesCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation((opts: unknown) => ({
      _constructorOpts: opts,
      messages: { create: mockMessagesCreate },
    })),
  };
});

// Capture the mocked Anthropic constructor after the mock is hoisted
import Anthropic from '@anthropic-ai/sdk';
const MockAnthropic = vi.mocked(Anthropic);

function makeTextResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

const VALID_RESPONSE = JSON.stringify({ summary: 'We discussed the project.', followUps: ['Send follow-up email'] });

describe('AnthropicSdkClient', () => {
  beforeEach(() => {
    mockMessagesCreate.mockClear();
    MockAnthropic.mockClear();
  });

  // ---------------------------------------------------------------------------
  // isConfigured
  // ---------------------------------------------------------------------------
  it('isConfigured is false when apiKey is undefined; SDK constructor not called', () => {
    const client = new AnthropicSdkClient(undefined, 'claude-haiku-4-5-20251001');
    expect(client.isConfigured).toBe(false);
    expect(MockAnthropic).not.toHaveBeenCalled();
  });

  it('isConfigured is true when apiKey is provided', () => {
    const client = new AnthropicSdkClient('sk-ant-test', 'claude-haiku-4-5-20251001');
    expect(client.isConfigured).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // SDK construction options
  // ---------------------------------------------------------------------------
  it('constructs SDK with timeout:30000', () => {
    new AnthropicSdkClient('sk-ant-test', 'claude-haiku-4-5-20251001');
    expect(MockAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 30_000 })
    );
  });

  // ---------------------------------------------------------------------------
  // messages.create arguments
  // ---------------------------------------------------------------------------
  it('calls messages.create with configured model and max_tokens:1024', async () => {
    mockMessagesCreate.mockResolvedValueOnce(makeTextResponse(VALID_RESPONSE));
    const client = new AnthropicSdkClient('sk-ant-test', 'claude-haiku-4-5-20251001');
    await client.summarize('some raw text');

    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1024,
      })
    );
  });

  it('passes rawText as the user message content', async () => {
    mockMessagesCreate.mockResolvedValueOnce(makeTextResponse(VALID_RESPONSE));
    const client = new AnthropicSdkClient('sk-ant-test', 'claude-haiku-4-5-20251001');
    await client.summarize('verbatim raw text');

    const callArgs = mockMessagesCreate.mock.calls[0]?.[0] as { messages: { role: string; content: string }[] };
    expect(callArgs.messages).toEqual([{ role: 'user', content: 'verbatim raw text' }]);
  });

  // ---------------------------------------------------------------------------
  // Nudge system prompt
  // ---------------------------------------------------------------------------
  it('base call uses system prompt without nudge prefix', async () => {
    mockMessagesCreate.mockResolvedValueOnce(makeTextResponse(VALID_RESPONSE));
    const client = new AnthropicSdkClient('sk-ant-test', 'claude-haiku-4-5-20251001');
    await client.summarize('text');

    const callArgs = mockMessagesCreate.mock.calls[0]?.[0] as { system: string };
    expect(callArgs.system).not.toContain('did not match the required shape');
  });

  it('nudge call prepends correction phrase to system prompt', async () => {
    mockMessagesCreate.mockResolvedValueOnce(makeTextResponse(VALID_RESPONSE));
    const client = new AnthropicSdkClient('sk-ant-test', 'claude-haiku-4-5-20251001');
    await client.summarize('text', { nudge: true });

    const callArgs = mockMessagesCreate.mock.calls[0]?.[0] as { system: string };
    expect(callArgs.system).toContain('did not match the required shape');
  });

  it('nudge call still passes rawText unchanged as the user message', async () => {
    mockMessagesCreate.mockResolvedValueOnce(makeTextResponse(VALID_RESPONSE));
    const client = new AnthropicSdkClient('sk-ant-test', 'claude-haiku-4-5-20251001');
    await client.summarize('original note text', { nudge: true });

    const callArgs = mockMessagesCreate.mock.calls[0]?.[0] as { messages: { content: string }[] };
    expect(callArgs.messages[0]?.content).toBe('original note text');
  });

  // ---------------------------------------------------------------------------
  // Defensive missing-key guard in summarize()
  // ---------------------------------------------------------------------------
  it('summarize() throws before any SDK call when key was absent', async () => {
    const client = new AnthropicSdkClient(undefined, 'claude-haiku-4-5-20251001');
    await expect(client.summarize('text')).rejects.toThrow('not configured');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});
