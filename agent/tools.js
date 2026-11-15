(function (root) {
  'use strict';

  var TOOL_DECLARATIONS = [
    {
      type: 'function',
      function: {
        name: 'set_field',
        description: 'Define ou atualiza os dados da lavoura do produtor (área em hectares ou texto com unidade como tarefas/alqueires/metros, cultura agrícola e dificuldade principal) usando parseArea() e fill().',
        parameters: {
          type: 'object',
          properties: {
            area_ha: {
              description: 'Tamanho da área em hectares (número) ou texto com unidade (ex.: "3 tarefas", "2 hectares e meio", "5000 metros").',
              anyOf: [{ type: 'number' }, { type: 'string' }]
            },
            crop: {
              type: 'string',
              description: 'Cultura plantada (ex.: Milho, Feijão, Mandioca, Hortaliças).'
            },
            main_difficulty: {
              type: 'string',
              description: 'Principal dificuldade na lavoura (ex.: seca/falta de chuva, praga, solo/terra fraca, mercado/preço).'
            }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'change_area',
        description: 'Altera a área da lavoura a partir de texto com unidade ou número e recalcula a análise se cultura e dificuldade já estiverem definidas.',
        parameters: {
          type: 'object',
          properties: {
            texto: {
              type: 'string',
              description: 'Texto descrevendo a nova área (ex.: "10 hectares", "5 tarefas", "3 hectares").'
            }
          },
          required: ['texto']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_analysis',
        description: 'Executa pipe() e build() para calcular os indicadores orbitais da NASA, as 3 estratégias de manejo e a estimativa de produção em JSON.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'show_charts',
        description: 'Exibe os gráficos comparativos de Água, Terra, Custo e Produção na tela chamando viz(true).',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'hide_charts',
        description: 'Oculta os gráficos da tela chamando viz(false).',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'switch_strategy',
        description: 'Alterna a estratégia de manejo em foco (0: Como é hoje, 1: Rotação, 2: Adubo verde) e atualiza os gráficos se visíveis.',
        parameters: {
          type: 'object',
          properties: {
            index: {
              type: 'integer',
              description: 'Índice opcional da estratégia (0, 1 ou 2). Se omitido, avança para a próxima estratégia.'
            }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_profile',
        description: 'Retorna o perfil e os fatos agronômicos memorizados do produtor.',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'remember',
        description: 'Salva um fato agronômico relevante do produtor na memória seletiva local.',
        parameters: {
          type: 'object',
          properties: {
            fato: {
              type: 'string',
              description: 'Fato agronômico conciso a memorizar (ex.: "Planta milho em novembro", "Não possui irrigação").'
            }
          },
          required: ['fato']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'ask_user',
        description: 'Indica qual informação ainda falta coletar do produtor (area, crop ou pain) e define a próxima pergunta.',
        parameters: {
          type: 'object',
          properties: {
            slot: {
              type: 'string',
              enum: ['area', 'crop', 'pain'],
              description: 'Slot faltante a perguntar.'
            }
          },
          required: ['slot']
        }
      }
    }
  ];

  function missingSlots() {
    var A = root.A || {};
    var missing = [];
    if (A.area == null) missing.push('area');
    if (!A.crop) missing.push('crop');
    if (!A.pain) missing.push('pain');
    return missing;
  }

  function syncStateFromSlots() {
    var m = missingSlots();
    if (m.length === 0) {
      root.state = 'ready';
    } else {
      root.state = m[0];
    }
    return m;
  }

  function formatAnalysisResult() {
    var A = root.A || {};
    var plan = root.plan;
    if (!plan) return null;
    var selIdx = typeof root.sel === 'number' ? root.sel : plan.best;
    var fmtA = typeof root.fmtA === 'function' ? root.fmtA : function (x) { return x + ' ha'; };
    var fmtP = typeof root.fmtP === 'function' ? root.fmtP : function (c, p) { return p + ' t'; };
    var lvl = typeof root.lvl === 'function' ? root.lvl : function (x) { return x < 35 ? 'baixo' : x < 60 ? 'médio' : 'alto'; };

    var strategies = plan.S.map(function (s, idx) {
      return {
        index: idx,
        mode: s.p,
        label: s.l,
        title: s.t,
        water_score: s.w,
        soil_score: s.s,
        cost_score: s.c,
        score: Math.round(s.sc * 10) / 10,
        production_tons: Math.round(s.prod * 100) / 100,
        production_formatted: fmtP(A.crop, s.prod, 1),
        production_short: fmtP(A.crop, s.prod, 0),
        why: s.why
      };
    });

    return {
      ok: true,
      area_ha: Math.round(A.area * 10000) / 10000,
      area_formatted: fmtA(A.area),
      crop: A.crop,
      main_difficulty: A.pain,
      indicators: Object.assign({}, plan.d, {
        water_stress_level: lvl(plan.d.ws),
        soil_degradation_level: lvl(plan.d.sd),
        soil_moisture_class: plan.d.smap < 0.18 ? 'baixa' : plan.d.smap < 0.26 ? 'regular' : 'boa'
      }),
      best_index: plan.best,
      selected_index: selIdx,
      recommended_strategy: strategies[plan.best],
      current_strategy: strategies[0],
      strategies: strategies,
      chunks: plan.chunks
    };
  }

  var implementations = {
    set_field: function (args) {
      var a = args || {};
      var norm = typeof root.norm === 'function' ? root.norm : function (s) { return String(s || '').toLowerCase(); };
      var updated = [];

      if (a.area_ha !== undefined && a.area_ha !== null && a.area_ha !== '') {
        if (typeof a.area_ha === 'number' && a.area_ha > 0) {
          root.state = 'area';
          root.fill(norm(String(a.area_ha) + ' hectares'));
          if (root.A.area == null) root.A.area = a.area_ha;
          updated.push('area');
        } else {
          var areaStr = norm(String(a.area_ha));
          var parsed = typeof root.parseArea === 'function' ? root.parseArea(areaStr) : null;
          if (parsed != null && parsed > 0 && parsed < 1e5) {
            root.A.area = parsed;
            updated.push('area');
          } else {
            root.state = 'area';
            if (root.fill(areaStr).indexOf('area') !== -1) updated.push('area');
          }
        }
      }

      if (a.crop) {
        var cropNorm = norm(String(a.crop));
        var resCrop = root.fill(cropNorm);
        if (resCrop.indexOf('crop') !== -1) updated.push('crop');
      }

      if (a.main_difficulty) {
        var diffNorm = norm(String(a.main_difficulty));
        root.state = 'pain';
        var resPain = root.fill(diffNorm);
        if (resPain.indexOf('pain') !== -1) updated.push('pain');
      }

      if (root.SOLMemory) {
        root.SOLMemory.extractFactsFromTurn('', root.A);
      }

      var missing = syncStateFromSlots();
      var fmtA = typeof root.fmtA === 'function' ? root.fmtA : function (x) { return x + ' ha'; };
      return {
        ok: true,
        updated: updated,
        area_ha: root.A.area != null ? Math.round(root.A.area * 10000) / 10000 : null,
        area_formatted: root.A.area != null ? fmtA(root.A.area) : null,
        crop: root.A.crop,
        main_difficulty: root.A.pain,
        missing_slots: missing
      };
    },

    change_area: function (args) {
      var a = args || {};
      var rawText = String(a.texto || a.text || a.area_ha || '');
      var norm = typeof root.norm === 'function' ? root.norm : function (s) { return String(s || '').toLowerCase(); };
      var v = typeof root.parseArea === 'function' ? root.parseArea(norm(rawText)) : null;

      if (v != null && v > 0 && v < 1e5) {
        root.A.area = v;
        if (root.SOLMemory) {
          root.SOLMemory.remember('Área alterada para ' + (typeof root.fmtA === 'function' ? root.fmtA(v) : v + ' ha'), 'area', 'stated');
        }
        if (root.A.crop && root.A.pain) {
          return implementations.run_analysis();
        }
        var missing = syncStateFromSlots();
        return {
          ok: true,
          area_ha: Math.round(v * 10000) / 10000,
          area_formatted: typeof root.fmtA === 'function' ? root.fmtA(v) : v + ' ha',
          missing_slots: missing
        };
      }

      root.A.area = null;
      root.state = 'area';
      return {
        ok: true,
        area_ha: null,
        needs_area: true,
        missing_slots: missingSlots()
      };
    },

    run_analysis: function () {
      var missing = missingSlots();
      if (missing.length > 0) {
        syncStateFromSlots();
        return {
          ok: false,
          error: 'missing_slots',
          missing_slots: missing
        };
      }
      root.L = root.L || root.FB;
      root.plan = root.build();
      root.sel = root.plan.best;
      root.state = 'ready';
      var vizEl = typeof root.$ === 'function' ? root.$('viz') : null;
      if (vizEl && !vizEl.hidden && typeof root.renderViz === 'function') {
        root.renderViz();
      }
      return formatAnalysisResult();
    },

    show_charts: function () {
      if (!root.plan && root.A && root.A.area != null && root.A.crop && root.A.pain) {
        implementations.run_analysis();
      }
      if (!root.plan) {
        return {
          ok: false,
          error: 'no_plan_available',
          missing_slots: missingSlots()
        };
      }
      if (typeof root.viz === 'function') {
        root.viz(true);
      }
      return {
        ok: true,
        charts_visible: true,
        selected_index: root.sel,
        selected_strategy: root.plan.S[root.sel].t
      };
    },

    hide_charts: function () {
      if (typeof root.viz === 'function') {
        root.viz(false);
      }
      return {
        ok: true,
        charts_visible: false
      };
    },

    switch_strategy: function (args) {
      if (!root.plan && root.A && root.A.area != null && root.A.crop && root.A.pain) {
        implementations.run_analysis();
      }
      if (!root.plan) {
        return {
          ok: false,
          error: 'no_plan_available',
          missing_slots: missingSlots()
        };
      }
      var a = args || {};
      if (typeof a.index === 'number' && a.index >= 0 && a.index < root.plan.S.length) {
        root.sel = a.index;
      } else {
        root.sel = (root.sel + 1) % 3;
      }
      var vizEl = typeof root.$ === 'function' ? root.$('viz') : null;
      if (vizEl && !vizEl.hidden && typeof root.renderViz === 'function') {
        root.renderViz();
      }
      var X = root.plan.S[root.sel];
      var fmtP = typeof root.fmtP === 'function' ? root.fmtP : function (c, p) { return p + ' t'; };
      return {
        ok: true,
        selected_index: root.sel,
        strategy: {
          index: root.sel,
          mode: X.p,
          title: X.t,
          why: X.why,
          water_score: X.w,
          soil_score: X.s,
          cost_score: X.c,
          production_tons: Math.round(X.prod * 100) / 100,
          production_formatted: fmtP(root.A.crop, X.prod, 1)
        }
      };
    },

    get_profile: function () {
      if (root.SOLMemory) {
        return Object.assign({ ok: true }, root.SOLMemory.getProfile());
      }
      return {
        ok: true,
        slots: {
          area_ha: root.A ? root.A.area : null,
          crop: root.A ? root.A.crop : null,
          main_difficulty: root.A ? root.A.pain : null
        },
        facts: []
      };
    },

    remember: function (args) {
      var a = args || {};
      var fact = a.fato || a.fact || '';
      if (!root.SOLMemory) {
        return { ok: false, error: 'memory_unavailable' };
      }
      var entry = root.SOLMemory.remember(fact, a.category || 'note', a.origin || 'stated');
      return {
        ok: Boolean(entry),
        stored: entry
      };
    },

    ask_user: function (args) {
      var a = args || {};
      var m = missingSlots();
      var targetSlot = a.slot || (m.length ? m[0] : 'ready');
      root.state = targetSlot;
      var defaultQuestions = {
        area: 'Me conta: qual é o tamanho da sua lavoura? Pode falar em hectares, tarefas ou metros, do jeito que preferir.',
        crop: 'E o que você planta hoje? Milho, feijão, mandioca ou hortaliças?',
        pain: 'E o que mais tem te preocupado na lavoura ultimamente? Falta de chuva, praga, terra fraca ou preço pra vender?'
      };
      return {
        ok: true,
        slot: targetSlot,
        missing_slots: m,
        suggested_question: defaultQuestions[targetSlot] || null
      };
    }
  };

  function executeTool(name, args) {
    var fn = implementations[name];
    if (!fn) {
      return { ok: false, error: 'unknown_tool: ' + name };
    }
    try {
      return fn(args || {});
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  var SOLTools = {
    TOOL_DECLARATIONS: TOOL_DECLARATIONS,
    executeTool: executeTool,
    missingSlots: missingSlots,
    formatAnalysisResult: formatAnalysisResult
  };

  root.SOLTools = SOLTools;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SOLTools;
  }
})(typeof window !== 'undefined' ? window : globalThis);
