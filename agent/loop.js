(function (root) {
  'use strict';

  var MAX_ITERATIONS = 4;
  var customTransport = null;

  function getSelectedModel() {
    if (root.SOL_FORCE_MODEL) return String(root.SOL_FORCE_MODEL);
    try {
      if (typeof location !== 'undefined' && location.search) {
        var params = new URLSearchParams(location.search);
        var m = params.get('model');
        if (m) return m.trim();
      }
    } catch (e) {}
    return null;
  }

  async function defaultHttpTransport(payload) {
    if (typeof location !== 'undefined' && location.protocol === 'file:' && !root.SOL_ALLOW_FILE_FETCH) {
      throw new Error('Offline file:// protocol');
    }
    if (typeof fetch !== 'function') {
      throw new Error('fetch unavailable');
    }
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 6500) : null;
    try {
      var modelParam = payload.model ? '?model=' + encodeURIComponent(payload.model) : '';
      var res = await fetch('/api/agent/chat' + modelParam, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function buildAllowedNumbers(toolResults) {
    var prompts = root.SOLPrompts;
    if (!prompts) return [];
    var allowed = [];
    prompts.collectAllowedNumbers(toolResults, allowed);
    if (root.A && root.A.area != null) {
      prompts.collectAllowedNumbers(root.A.area, allowed);
      if (typeof root.fmtA === 'function') {
        prompts.collectAllowedNumbers(root.fmtA(root.A.area), allowed);
      }
    }
    if (root.plan) {
      prompts.collectAllowedNumbers(root.plan.d, allowed);
      prompts.collectAllowedNumbers(root.plan.S, allowed);
      prompts.collectAllowedNumbers(root.plan.chunks, allowed);
      [30, 35, 60, 100].forEach(function (c) {
        if (allowed.indexOf(c) === -1) allowed.push(c);
      });
    }
    return allowed;
  }

  function synthesizeDeterministicFromTools(toolResults) {
    for (var i = toolResults.length - 1; i >= 0; i--) {
      var tr = toolResults[i];
      var res = tr && tr.result;
      if (!res) continue;
      if (tr.name === 'run_analysis' && Array.isArray(res.chunks) && res.chunks.length) {
        return res.chunks.slice(0, 4);
      }
      if (tr.name === 'change_area' && Array.isArray(res.chunks) && res.chunks.length) {
        var areaLabel = res.area_formatted || '';
        return ['Prontinho! Refiz as previsões para ' + areaLabel + '.', res.chunks[2], res.chunks[3]];
      }
      if (tr.name === 'switch_strategy' && res.strategy) {
        return [
          res.strategy.title + '. ' + res.strategy.why,
          'Com essa opção, estimo ' + res.production_formatted + ' por safra.'
        ];
      }
      if (tr.name === 'show_charts' && res.ok) {
        return ['Aqui estão os gráficos da sua terra!'];
      }
      if (tr.name === 'hide_charts' && res.ok) {
        return ['Prontinho, tela limpa pra você!'];
      }
      if ((tr.name === 'ask_user' || tr.name === 'set_field') && res.missing_slots && res.missing_slots.length) {
        var nextSlot = res.slot || res.missing_slots[0];
        var askRes = root.SOLTools.executeTool('ask_user', { slot: nextSlot });
        if (askRes && askRes.suggested_question) return [askRes.suggested_question];
      }
    }
    return null;
  }

  async function runAgentTurn(t, raw, fallbackFn) {
    var transport = customTransport || defaultHttpTransport;
    var memory = root.SOLMemory;
    var tools = root.SOLTools;
    var prompts = root.SOLPrompts;

    if (!tools || !prompts) {
      if (typeof fallbackFn === 'function') fallbackFn(t, raw);
      return { mode: 'fallback', reason: 'missing_modules' };
    }

    var userUtterance = String(raw || t || '').trim();
    var chosenModel = getSelectedModel();
    var messages = memory ? memory.getRecentTurns() : [];
    messages.push({ role: 'user', content: userUtterance });

    var toolResults = [];
    var finalChunks = null;
    var lastMeta = null;

    try {
      for (var iter = 0; iter < MAX_ITERATIONS; iter++) {
        var stateContext = memory ? memory.buildStateContext() : {};
        var promptContext = memory ? memory.buildBudgetedPromptContext() : '';

        var reqPayload = {
          transcript: t,
          raw_transcript: userUtterance,
          model: chosenModel,
          stream: false,
          state_context: stateContext,
          messages: messages,
          tools: tools.TOOL_DECLARATIONS,
          tool_results: toolResults,
          system_prompt: promptContext
        };

        var response = await transport(reqPayload);
        if (!response || response.fallback || response.ok === false) {
          throw new Error((response && response.reason) || 'backend_fallback');
        }

        lastMeta = response.meta || null;
        var calls = Array.isArray(response.tool_calls) ? response.tool_calls : [];

        if (calls.length > 0) {
          messages.push({
            role: 'assistant',
            content: response.text || '',
            tool_calls: calls
          });

          for (var cIdx = 0; cIdx < calls.length; cIdx++) {
            var call = calls[cIdx];
            var execResult = tools.executeTool(call.name, call.arguments || {});
            toolResults.push({
              id: call.id || ('call_' + iter + '_' + cIdx),
              name: call.name,
              arguments: call.arguments || {},
              result: execResult
            });
            messages.push({
              role: 'tool',
              tool_call_id: call.id || ('call_' + iter + '_' + cIdx),
              name: call.name,
              content: JSON.stringify(execResult)
            });
          }

          // If the model only requested tools without final text, continue next iteration
          if (!response.text && (!response.chunks || !response.chunks.length)) {
            continue;
          }
        }

        var candidateText = response.text || (Array.isArray(response.chunks) ? response.chunks.join(' ') : '');
        if (candidateText) {
          var allowedNums = buildAllowedNumbers(toolResults);
          var grounding = prompts.verifyNumericGrounding(candidateText, allowedNums);
          if (!grounding.valid) {
            var safeFromTools = synthesizeDeterministicFromTools(toolResults);
            if (safeFromTools && safeFromTools.length) {
              finalChunks = safeFromTools;
              break;
            }
            throw new Error('ungrounded_numbers: ' + grounding.ungrounded.join(','));
          }
          finalChunks = prompts.splitSpeechChunks(candidateText, 200);
          break;
        }
      }

      if (!finalChunks || !finalChunks.length) {
        var synth = synthesizeDeterministicFromTools(toolResults);
        if (synth && synth.length) {
          finalChunks = synth;
        } else {
          throw new Error('empty_agent_response');
        }
      }

      if (memory) {
        memory.extractFactsFromTurn(userUtterance, root.A);
        memory.recordTurn('user', userUtterance);
        memory.recordTurn('assistant', finalChunks.join(' '));
      }

      if (typeof root.seq === 'function') {
        root.seq(finalChunks, root.again);
      }

      return {
        mode: 'agent',
        chunks: finalChunks,
        tool_results: toolResults,
        meta: lastMeta
      };
    } catch (err) {
      if (typeof fallbackFn === 'function') {
        fallbackFn(t, raw);
      }
      return {
        mode: 'fallback',
        reason: String(err && err.message ? err.message : err),
        tool_results: toolResults
      };
    }
  }

  function handle(t, raw, fallbackFn) {
    return runAgentTurn(t, raw, fallbackFn);
  }

  function setTransport(fn) {
    customTransport = typeof fn === 'function' ? fn : null;
  }

  var SOLAgent = {
    handle: handle,
    runAgentTurn: runAgentTurn,
    setTransport: setTransport,
    getSelectedModel: getSelectedModel,
    MAX_ITERATIONS: MAX_ITERATIONS
  };

  root.SOLAgent = SOLAgent;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SOLAgent;
  }
})(typeof window !== 'undefined' ? window : globalThis);
