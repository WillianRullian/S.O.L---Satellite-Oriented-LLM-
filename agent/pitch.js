(function (root) {
  'use strict';

  var pitchCursor = 0;

  function isPitchModeActive() {
    if (root.SOL_PITCH_MODE === true || root.SOL_PITCH_MODE === '1') return true;
    try {
      if (typeof location !== 'undefined' && location.search) {
        var params = new URLSearchParams(location.search);
        var p = params.get('pitch');
        if (p === '1' || p === 'true' || p === 'demo') return true;
      }
    } catch (e) {}
    return false;
  }

  function extractAreaText(raw) {
    var m = String(raw || '').match(/(?:(?:\d+(?:[.,]\d+)?)|(?:um|uma|dois|duas|tres|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez|vinte|trinta|meio|meia))\s*(?:e\s*(?:meio|meia)\s*)?(?:hectares?|ha|tarefas?|metros?(?:\s*quadrados)?|m2|alqueires?)/i);
    return m ? m[0].trim() : null;
  }

  function detectCrop(norm) {
    if (/feij/.test(norm)) return 'Feijão';
    if (/milho/.test(norm)) return 'Milho';
    if (/mandioca|macaxeira|aipim/.test(norm)) return 'Mandioca';
    if (/horta|verdura|legume/.test(norm)) return 'Hortaliças';
    return null;
  }

  function detectPain(norm) {
    if (/chuva|seca|agua|estiagem|hidric/.test(norm)) return 'seca';
    if (/praga|doenca|lagarta|bicho|inseto/.test(norm)) return 'praga';
    if (/fraca|solo|adubo|cansad|erosao/.test(norm)) return 'solo';
    if (/preco|venda|vender|mercado|dinheiro/.test(norm)) return 'mercado';
    return null;
  }

  function buildPitchIntroReply(tools) {
    if (root.A && root.A.area != null && root.A.crop && root.A.pain) {
      return {
        chunks: [
          'Oi! Que alegria estar aqui com vocês! Eu sou a Sol, da Big Tech, parceira de voz de quem produz no campo.',
          'Já estou acompanhando a sua área e pronta para responder dúvidas ou mostrar os gráficos na tela.'
        ],
        tool_results: [],
        pitch_scene: 'intro'
      };
    }
    var askRes = tools.executeTool('ask_user', { slot: 'area' });
    return {
      chunks: [
        'Oi! Que alegria estar aqui com vocês! Eu sou a Sol, da Big Tech, sua parceira de campo guiada por voz.',
        'Me conta qual é o tamanho da sua área, o que você planta e o que mais te preocupa hoje!'
      ],
      tool_results: [{ id: 'pitch_ask', name: 'ask_user', arguments: { slot: 'area' }, result: askRes }],
      pitch_scene: 'intro'
    };
  }

  function buildFullAnalysisReply(analysis, prompts) {
    if (!analysis || !analysis.indicators || !analysis.recommended_strategy) return null;
    var d = analysis.indicators;
    var rec = analysis.recommended_strategy;
    var cur = analysis.current_strategy;
    var raw = [
      'Prontinho! Os satélites mostram chuva recente de ' + d.r30 + ' milímetros e risco de falta de água ' + (typeof root.lvl === 'function' ? root.lvl(d.ws) : 'estimado') + ' na sua área de ' + analysis.area_formatted + '.',
      'Para ganhar fôlego e produtividade, recomendo ' + rec.title + ', estimando ' + rec.production_formatted + ' por safra contra ' + cur.production_formatted + ' no manejo atual.',
      'São estimativas simuladas para apoiar sua decisão; confirme sempre com o técnico agrícola local e me peça para mostrar os gráficos se quiser ver!'
    ].join(' ');
    return prompts.splitSpeechChunks(raw, 200);
  }

  function buildTechnicalReply(tools, prompts) {
    var tr = [];
    if (!root.A || root.A.area == null || !root.A.crop || !root.A.pain) {
      var sf = tools.executeTool('set_field', {
        area_ha: (root.A && root.A.area != null) ? root.A.area : '3 tarefas',
        crop: (root.A && root.A.crop) ? root.A.crop : 'Milho',
        main_difficulty: (root.A && root.A.pain) ? root.A.pain : 'seca'
      });
      tr.push({ id: 'pitch_tech_sf', name: 'set_field', arguments: {}, result: sf });
    }
    var an = tools.executeTool('run_analysis', {});
    tr.push({ id: 'pitch_tech_an', name: 'run_analysis', arguments: {}, result: an });
    var d = an.indicators;
    var raw = [
      'Pelas estimativas orbitais simuladas, o NDVI do MODIS está em ' + d.ndvi + ' e a umidade volumétrica no SMAP marca ' + d.smap + ', com ' + d.hot + ' dias acima de 35 graus no ECOSTRESS.',
      'Manter palhada e rotação de culturas reduz a evapotranspiração direta do solo e o risco hídrico, hoje com índice ' + d.ws + ' numa escala até 100; valide o manejo com o engenheiro agrônomo local.'
    ].join(' ');
    return {
      chunks: prompts.splitSpeechChunks(raw, 200),
      tool_results: tr,
      pitch_scene: 'technical_adaptation'
    };
  }

  function matchLocalAction(t, userUtterance, tools, prompts) {
    var norm = String(t || '').toLowerCase().trim();
    var isQuestion = /[?]|\b(por\s+que|como|e\s+se|posso|quando|qual|quais|vale|ajuda|explic|sera|funciona)\b/.test(norm);
    var wordCount = norm.split(/\s+/).filter(Boolean).length;

    if (/esconde|fech|ocult|sumir|limpa/.test(norm) && /grafic|tela|plano/.test(norm) && wordCount <= 8) {
      var hRes = tools.executeTool('hide_charts', {});
      return {
        chunks: ['Prontinho, ocultei os gráficos para deixar a tela limpa!'],
        tool_results: [{ id: 'fast_hide', name: 'hide_charts', arguments: {}, result: hRes }],
        pitch_scene: 'hide_charts'
      };
    }

    if (/grafic|mostr|ver (o )?plano|barra|na tela/.test(norm) && !isQuestion && wordCount <= 8) {
      var sRes = tools.executeTool('show_charts', {});
      if (sRes && sRes.ok) {
        return {
          chunks: ['Aqui estão os gráficos comparativos de água, terra, economia e produção da sua área!'],
          tool_results: [{ id: 'fast_show', name: 'show_charts', arguments: {}, result: sRes }],
          pitch_scene: 'show_charts'
        };
      }
    }

    if (root.plan && /\b(outro|outra\s+opcao|proxim[ao]\s+estrateg|trocar\s+estrateg)\b/.test(norm) && !isQuestion && wordCount <= 8) {
      var swRes = tools.executeTool('switch_strategy', {});
      if (swRes && swRes.ok && swRes.strategy) {
        var st = swRes.strategy;
        var chunksSw = prompts.splitSpeechChunks(
          'Trocando para ' + st.title + '. ' + st.why + ' A produção estimada fica em ' + st.production_formatted + ' por safra.',
          200
        );
        return {
          chunks: chunksSw,
          tool_results: [{ id: 'fast_switch', name: 'switch_strategy', arguments: {}, result: swRes }],
          pitch_scene: 'switch_strategy'
        };
      }
    }

    if (/(mud|alter|troc|corrig)\w*.*(area|tamanho|terra|lavoura)/.test(norm) && !isQuestion) {
      var cRes = tools.executeTool('change_area', { texto: userUtterance });
      if (cRes && cRes.ok && cRes.recommended_strategy) {
        var rec = cRes.recommended_strategy;
        var chChunks = prompts.splitSpeechChunks(
          'Prontinho! Atualizei sua área para ' + cRes.area_formatted + '. Com ' + rec.title + ', a estimativa passa para ' + rec.production_formatted + ' por safra. Confirme sempre com o técnico agrícola.',
          200
        );
        return {
          chunks: chChunks,
          tool_results: [{ id: 'fast_chg', name: 'change_area', arguments: { texto: userUtterance }, result: cRes }],
          pitch_scene: 'change_area'
        };
      }
    }

    return null;
  }

  function runStepByCursor(tools, prompts) {
    var step = pitchCursor % 5;
    pitchCursor += 1;
    if (step === 0) return buildPitchIntroReply(tools);
    if (step === 1) return runMultiSlotScene('3 tarefas', 'Milho', 'seca', tools, prompts);
    if (step === 2) return matchLocalAction('mostrar graficos', 'mostrar gráficos', tools, prompts);
    if (step === 3) return matchLocalAction('mudar area para 5 hectares', 'mudar área para 5 hectares', tools, prompts);
    return buildTechnicalReply(tools, prompts);
  }

  function runMultiSlotScene(areaText, crop, pain, tools, prompts) {
    var args = {};
    if (areaText) args.area_ha = areaText;
    if (crop) args.crop = crop;
    if (pain) args.main_difficulty = pain;

    var sf = tools.executeTool('set_field', args);
    var tr = [{ id: 'pitch_sf', name: 'set_field', arguments: args, result: sf }];

    if (!sf.missing_slots || sf.missing_slots.length === 0) {
      var an = tools.executeTool('run_analysis', {});
      tr.push({ id: 'pitch_an', name: 'run_analysis', arguments: {}, result: an });
      var chunks = buildFullAnalysisReply(an, prompts);
      if (chunks) {
        return { chunks: chunks, tool_results: tr, pitch_scene: 'full_analysis' };
      }
    }

    var nextSlot = (sf.missing_slots && sf.missing_slots[0]) || 'area';
    var askRes = tools.executeTool('ask_user', { slot: nextSlot });
    tr.push({ id: 'pitch_ask_next', name: 'ask_user', arguments: { slot: nextSlot }, result: askRes });
    var prefix = (nextSlot === 'crop' && sf.area_formatted)
      ? 'Anotei ' + sf.area_formatted + '! '
      : (nextSlot === 'pain' && root.A && root.A.crop ? 'Anotei ' + root.A.crop.toLowerCase() + '! ' : '');
    return {
      chunks: prompts.splitSpeechChunks(prefix + (askRes.suggested_question || ''), 200),
      tool_results: tr,
      pitch_scene: 'slot_' + nextSlot
    };
  }

  function matchAndExecute(t, userUtterance, tools, prompts) {
    if (!tools || !prompts) return null;
    var norm = String(t || '').toLowerCase().trim();

    // Local pure UI / area actions work fast in all modes
    var localAct = matchLocalAction(norm, userUtterance, tools, prompts);
    if (localAct) return localAct;

    if (!isPitchModeActive()) {
      return null;
    }

    // 1. Sequential step shortcut for short live demos ("próximo passo" / "próxima cena")
    if (/\b(proxim[ao]\s+(passo|cena|etapa)|avanc(ar|e)|continuar\s+demo)\b/.test(norm)) {
      return runStepByCursor(tools, prompts);
    }

    // 2. Pesticide guardrail instant proof
    if (/\b(agrotoxico|veneno|defensivo|glifosato|receita|dosagem|quantos\s+litros|ml\s+por)\b/.test(norm)) {
      return {
        chunks: [
          'Eu não posso indicar receitas nem dosagens de agrotóxicos ou defensivos químicos por segurança.',
          'Para qualquer aplicação química, consulte sempre o técnico agrícola da sua região e peça o receituário agronômico.'
        ],
        tool_results: [],
        pitch_scene: 'guardrail_pesticide'
      };
    }

    // 3. Technical register instant proof (NDVI / SMAP / MODIS / ECOSTRESS / evapotranspiração)
    if (typeof prompts.detectTechnicalRegister === 'function' && prompts.detectTechnicalRegister(userUtterance)) {
      return buildTechnicalReply(tools, prompts);
    }

    // 4. Pitch welcome / intro
    if (/^(oi|ola|bom dia|boa tarde|boa noite)(\s+sol)?[.!?]*$/.test(norm) || /\b(apresente|quem e voce|investidor|banca|avaliador)\b/.test(norm)) {
      return buildPitchIntroReply(tools);
    }

    // 5. Off-script rain/planting risk question when context exists or can be analyzed immediately
    if (/\b(e\s+se\s+nao\s+chover|posso\s+plantar\s+mais\s+cedo|se\s+faltar\s+chuva|atrasar\s+a\s+chuva)\b/.test(norm)) {
      var trOff = [];
      if (!root.A || root.A.area == null || !root.A.crop || !root.A.pain) {
        trOff.push({
          id: 'pitch_off_sf',
          name: 'set_field',
          arguments: { area_ha: '3 tarefas', crop: 'Milho', main_difficulty: 'seca' },
          result: tools.executeTool('set_field', { area_ha: '3 tarefas', crop: 'Milho', main_difficulty: 'seca' })
        });
      }
      var offAn = tools.executeTool('run_analysis', {});
      trOff.push({ id: 'pitch_off_an', name: 'run_analysis', arguments: {}, result: offAn });
      var od = offAn.indicators;
      var offRaw = 'Se a chuva atrasar, antecipar o plantio aumenta o risco porque o índice de estresse hídrico está em ' + od.ws + ' numa escala até 100, com ' + od.r30 + ' milímetros recentes. Mantenha cobertura com palhada no solo e confirme a janela ideal com o técnico agrícola.';
      return {
        chunks: prompts.splitSpeechChunks(offRaw, 200),
        tool_results: trOff,
        pitch_scene: 'off_script_rain'
      };
    }

    // 6. Field slot capture (multi-slot in one speech or incremental)
    var areaTxt = extractAreaText(userUtterance);
    var crop = detectCrop(norm);
    var pain = detectPain(norm);
    if (areaTxt || crop || pain) {
      return runMultiSlotScene(areaTxt, crop, pain, tools, prompts);
    }

    return null;
  }

  function warmupPitchAudio() {
    if (!isPitchModeActive() || typeof root.prefetchTts !== 'function') return;
    var lines = [
      'Oi! Que alegria estar aqui com vocês! Eu sou a Sol, da Big Tech, sua parceira de campo guiada por voz.',
      'Me conta qual é o tamanho da sua área, o que você planta e o que mais te preocupa hoje!',
      'Aqui estão os gráficos comparativos de água, terra, economia e produção da sua área!',
      'Prontinho, ocultei os gráficos para deixar a tela limpa!',
      'Eu não posso indicar receitas nem dosagens de agrotóxicos ou defensivos químicos por segurança.'
    ];
    for (var i = 0; i < lines.length; i++) {
      root.prefetchTts(lines[i], i > 0 ? lines[i - 1] : '', i + 1 < lines.length ? lines[i + 1] : '');
    }
  }

  var SOLPitch = {
    isPitchModeActive: isPitchModeActive,
    matchAndExecute: matchAndExecute,
    warmupPitchAudio: warmupPitchAudio,
    resetCursor: function () { pitchCursor = 0; }
  };

  root.SOLPitch = SOLPitch;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SOLPitch;
  }
})(typeof window !== 'undefined' ? window : globalThis);
