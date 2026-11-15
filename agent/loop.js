(function (root) {
  'use strict';

  var MAX_ITERATIONS = 4;
  var customTransport = null;

  function inferImplicitToolCalls(t, userUtterance) {
    var norm = String(t || '').toLowerCase();
    var rawStr = String(userUtterance || '');
    var isQuestion = /[?]|\b(por\s+que|como|e\s+se|posso|quando|qual|quais|vale|ajuda|explic|sera|funciona)\b/.test(norm);
    var wordCount = norm.trim().split(/\s+/).filter(Boolean).length;
    var inferred = [];

    if (/esconde|fech|ocult|sumir|limpa/.test(norm) && wordCount <= 6) {
      inferred.push({ id: 'auto_hide', name: 'hide_charts', arguments: {} });
      return inferred;
    }
    if (/grafic|mostr|ver (o )?plano|barra|na tela/.test(norm) && !isQuestion && wordCount <= 6) {
      inferred.push({ id: 'auto_show', name: 'show_charts', arguments: {} });
      return inferred;
    }
    if (/(mud|alter|troc|corrig)\w*.*(area|tamanho|terra|lavoura)/.test(norm) && !isQuestion) {
      inferred.push({ id: 'auto_chg', name: 'change_area', arguments: { texto: userUtterance } });
      return inferred;
    }
    if (root.plan && /\b(outro|outra\s+opcao|proxim)\b/.test(norm) && !isQuestion && wordCount <= 6) {
      inferred.push({ id: 'auto_sw', name: 'switch_strategy', arguments: {} });
      return inferred;
    }

    // Only infer field slots silently on short non-question onboarding replies
    if (isQuestion || root.state === 'ready' || wordCount > 6) {
      return [];
    }

    var args = {};
    var hasSlot = false;
    if (typeof root.parseArea === 'function' && (root.state === 'area' || /hectare|\bha\b|tarefa|metro|m2|alqueire/.test(norm))) {
      var v = root.parseArea(norm);
      if (v != null && v > 0 && v < 1e5) {
        args.area_ha = userUtterance;
        hasSlot = true;
      }
    }
    var c = /feij/.test(norm) ? 'Feijão' : /milho/.test(norm) ? 'Milho' : /mandioca|macaxeira|aipim/.test(norm) ? 'Mandioca' : /horta|verdura|legume/.test(norm) ? 'Hortaliças' : null;
    if (c) {
      args.crop = c;
      hasSlot = true;
    }
    var p = /chuva|seca|agua|estiagem/.test(norm) ? 'seca' : /praga|doenca|lagarta|bicho|inseto/.test(norm) ? 'praga' : /fraca|solo|adubo|cansad/.test(norm) ? 'solo' : /preco|venda|vender|mercado|dinheiro/.test(norm) ? 'mercado' : null;
    if (p && (root.state === 'pain' || !root.A || !root.A.pain || /dificuldade|problema|preocup/.test(norm))) {
      args.main_difficulty = p;
      hasSlot = true;
    }
    if (hasSlot) {
      inferred.push({ id: 'auto_set', name: 'set_field', arguments: args });
    }
    return inferred;
  }

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
    var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;
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
      if ((tr.name === 'run_analysis' || tr.name === 'set_field') && Array.isArray(res.chunks) && res.chunks.length) {
        return res.chunks.slice(0, 4);
      }
      if (tr.name === 'research_agronomic_mock' || (tr.name === 'run_analysis' && res.is_preliminary_estimate)) {
        var outChunks = [];
        if (res.summary) outChunks.push(res.summary);
        if (res.recommendation) outChunks.push(res.recommendation);
        if (res.validation_note) outChunks.push(res.validation_note);
        if (outChunks.length && root.SOLPrompts) {
          return root.SOLPrompts.splitSpeechChunks(outChunks.join(' '), 200);
        }
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
        if (askRes && askRes.suggested_question) {
          var prefix = '';
          if (nextSlot === 'crop' && root.A && root.A.area != null && typeof root.fmtA === 'function') {
            prefix = 'Anotei ' + root.fmtA(root.A.area) + '. ';
          } else if (nextSlot === 'pain' && root.A && root.A.crop) {
            prefix = 'Anotei ' + root.A.crop.toLowerCase() + '! ';
          }
          return [prefix + askRes.suggested_question];
        }
      }
    }
    return null;
  }

  function setAriaBusy(isBusy) {
    if (typeof root.document === 'undefined' || !root.document || typeof root.document.getElementById !== 'function') {
      return;
    }
    var val = isBusy ? 'true' : 'false';
    var orb = root.document.getElementById('orb');
    if (orb && typeof orb.setAttribute === 'function') {
      orb.setAttribute('aria-busy', val);
    }
    var hint = root.document.getElementById('hint');
    if (hint && typeof hint.setAttribute === 'function') {
      hint.setAttribute('aria-busy', val);
    }
    if (typeof root.document.querySelector === 'function') {
      var main = root.document.querySelector('main');
      if (main && typeof main.setAttribute === 'function') {
        main.setAttribute('aria-busy', val);
      }
    }
  }

  function ensureAccessibilityAttrs() {
    if (typeof root.document === 'undefined' || !root.document || typeof root.document.getElementById !== 'function') {
      return;
    }
    var hint = root.document.getElementById('hint');
    if (hint && typeof hint.setAttribute === 'function') {
      hint.setAttribute('role', 'status');
      hint.setAttribute('aria-live', 'polite');
      hint.setAttribute('aria-atomic', 'true');
    }
  }

  function getToolStatusMessage(toolName, args) {
    var safeArgs = args || {};
    if (toolName === 'set_field' || toolName === 'change_area') {
      return 'Salvando dados no sistema interno…';
    }
    if (toolName === 'run_analysis') {
      return 'Consultando satélites e analisando…';
    }
    if (toolName === 'research_agronomic_mock') {
      var topic = String(safeArgs.topic || safeArgs.query || '').toLowerCase();
      var category = String(safeArgs.category || '').toLowerCase();
      if (category === 'satellite_soil' || /sat[eé]lit|ndvi|smap|nasa|sentinel|landsat|radar|umidade/.test(topic)) {
        return 'Consultando satélites…';
      }
      if (category === 'climate_zarc' || /chuva|clima|inmet|zarc|seca|previs|temperatura|geada/.test(topic)) {
        return 'Consultando sistema climático e ZARC…';
      }
      if (category === 'management_agronomy' || /solo|adub|calagem|plantio|manejo|embrapa|praga|doen[çc]/.test(topic)) {
        return 'Analisando manejo e dados agronômicos…';
      }
      return 'Consultando sistemas internos…';
    }
    if (toolName === 'get_profile' || toolName === 'remember') {
      return 'Buscando dados no sistema interno…';
    }
    if (toolName === 'show_charts' || toolName === 'hide_charts' || toolName === 'switch_strategy') {
      return 'Atualizando gráficos no sistema…';
    }
    return 'Consultando sistemas internos…';
  }

  function createProcessingFeedback(userUtterance) {
    ensureAccessibilityAttrs();
    setAriaBusy(true);

    var stages = [
      'Pensando…',
      'Buscando dados…',
      'Consultando sistema…',
      'Consultando satélites…',
      'Consultando sistemas internos…',
      'Analisando…'
    ];
    var stageIdx = 1;
    var timerId = null;
    var stopped = false;

    function emitStatus(text) {
      if (stopped || !text) return;
      if (typeof root.msg === 'function') {
        root.msg(text);
      } else if (typeof root.document !== 'undefined' && root.document && typeof root.document.getElementById === 'function') {
        var hint = root.document.getElementById('hint');
        if (hint) hint.textContent = text;
      }
    }

    var q = String(userUtterance || '').toLowerCase();
    var initialMsg = /sat[eé]lit|ndvi|smap|chuva|umidade/.test(q)
      ? 'Consultando satélites…'
      : 'Sol pensando…';
    emitStatus(initialMsg);

    if (typeof setInterval === 'function' && typeof clearInterval === 'function') {
      timerId = setInterval(function () {
        if (stopped) return;
        emitStatus(stages[stageIdx % stages.length]);
        stageIdx += 1;
      }, 900);
    }

    function stopTimer() {
      if (timerId !== null && typeof clearInterval === 'function') {
        clearInterval(timerId);
        timerId = null;
      }
    }

    return {
      onToolCall: function (toolName, args) {
        emitStatus(getToolStatusMessage(toolName, args));
      },
      onAnalyzing: function () {
        emitStatus('Analisando dados encontrados…');
      },
      beforeSpeech: function () {
        stopTimer();
        emitStatus('Preparando a voz da Sol…');
        stopped = true;
        setAriaBusy(false);
      },
      stop: function () {
        stopped = true;
        stopTimer();
        setAriaBusy(false);
      }
    };
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
    root._lastUserUtterance = userUtterance;
    if (
      memory &&
      typeof memory.restoreContextToRuntime === 'function' &&
      root.A && root.A.area == null && !root.A.crop && !root.A.pain &&
      !/\b(recome|do zero|reinici)\b/.test(String(t || '').toLowerCase())
    ) {
      memory.restoreContextToRuntime();
    }
    if (memory && typeof memory.extractFactsFromTurn === 'function') {
      memory.extractFactsFromTurn(userUtterance, root.A);
    }
    var chosenModel = getSelectedModel();
    var messages = memory ? memory.getRecentTurns() : [];
    messages.push({ role: 'user', content: userUtterance });

    var toolResults = [];
    var finalChunks = null;
    var lastMeta = null;
    var feedback = createProcessingFeedback(userUtterance);

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
        if (calls.length === 0 && iter === 0 && !response.guardrail) {
          var implicit = inferImplicitToolCalls(t, userUtterance);
          if (implicit.length > 0) {
            calls = implicit;
            response.text = '';
            response.chunks = [];
          }
        }

        if (calls.length > 0) {
          messages.push({
            role: 'assistant',
            content: response.text || '',
            tool_calls: calls
          });

          for (var cIdx = 0; cIdx < calls.length; cIdx++) {
            var call = calls[cIdx];
            feedback.onToolCall(call.name, call.arguments || {});
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
          feedback.onAnalyzing();

          // Bypass 2nd LLM round-trip only for pure UI toggles (show/hide charts) or trivial <=3-word confirmations
          if (!response.text && (!response.chunks || !response.chunks.length)) {
            var isPureUiCmd = calls.length === 1 && (calls[0].name === 'show_charts' || calls[0].name === 'hide_charts');
            var wordsLen = userUtterance.split(/\s+/).filter(Boolean).length;
            var isTrivialSlot = wordsLen <= 3 && !/[?]/.test(userUtterance) && calls.length === 1 && calls[0].name === 'set_field' && root.state !== 'ready';
            if (!customTransport && (isPureUiCmd || isTrivialSlot)) {
              var fastChunks = synthesizeDeterministicFromTools(toolResults);
              if (fastChunks && fastChunks.length) {
                finalChunks = fastChunks;
                break;
              }
            }
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
        if (typeof memory.saveContextSnapshot === 'function') {
          memory.saveContextSnapshot();
        }
      }

      feedback.beforeSpeech();
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
      feedback.stop();
      if (typeof fallbackFn === 'function') {
        fallbackFn(t, raw);
      }
      return {
        mode: 'fallback',
        reason: String(err && err.message ? err.message : err),
        tool_results: toolResults
      };
    } finally {
      feedback.stop();
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
