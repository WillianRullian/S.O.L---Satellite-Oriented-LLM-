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
              type: 'string',
              description: 'Tamanho da área em hectares ou texto com unidade (ex.: "2", "3 tarefas", "2 hectares e meio", "5000 metros").'
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
    },
    {
      type: 'function',
      function: {
        name: 'research_agronomic_mock',
        description: 'Pesquisa simulada (mock) instantânea para análises satelitais estendidas (NDVI, SMAP, ECOSTRESS, chuva, evapotranspiração), janela climática/ZARC, manejo de solo, consórcios, controle ecológico ou dúvidas fora do escopo padrão, garantindo resposta contínua sem travamentos.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Pergunta ou tópico a pesquisar (ex.: "previsão de chuva e umidade SMAP", "janela ZARC milho", "consórcio milho e feijão").'
            },
            category: {
              type: 'string',
              enum: ['satellite', 'climate_zarc', 'soil_management', 'pest_ecology', 'market', 'general'],
              description: 'Categoria da pesquisa agronômica ou satelital.'
            }
          },
          required: ['query']
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

  function computePreliminarySatelliteMock(areaOverride, cropOverride) {
    var prevA = root.A ? Object.assign({}, root.A) : { area: null, crop: null, pain: null };
    var prevL = root.L;
    try {
      root.L = root.L || root.FB || { lat: -14.9, lon: -40.8 };
      var useArea = areaOverride != null ? areaOverride : (prevA.area != null ? prevA.area : 2);
      var useCrop = cropOverride || prevA.crop || 'Milho';
      root.A = { area: useArea, crop: useCrop, pain: prevA.pain || 'seca' };
      var d = typeof root.pipe === 'function' ? root.pipe() : {
        rain: 680, tmax: 32.5, smap: 0.19, ndvi: 0.52, r30: 34, ext: 3, hot: 38, bare: 4, slope: 6, dev: -32, ws: 58, sd: 54
      };
      var eto = Math.round((3.4 + Math.max(0, d.tmax - 28) * 0.35 + (d.ws / 100) * 1.1) * 10) / 10;
      return Object.assign({}, d, {
        eto_mm_day: eto,
        assumed_area_ha: useArea,
        assumed_crop: useCrop,
        soil_moisture_class: d.smap < 0.18 ? 'baixa' : d.smap < 0.26 ? 'regular' : 'boa'
      });
    } finally {
      root.A = prevA;
      root.L = prevL;
    }
  }

  function inferResearchCategory(queryNorm, explicitCat) {
    if (explicitCat && explicitCat !== 'general') return explicitCat;
    if (/satelit|ndvi|smap|modis|ecostress|landsat|srtm|gpm|umidade|chuva|temperatura|calor|evapotransp/.test(queryNorm)) return 'satellite';
    if (/zarc|epoca|janela|plantar\s+cedo|antecip|geada|veranico|el\s+nino|la\s+nina|clima|previsao/.test(queryNorm)) return 'climate_zarc';
    if (/solo|terra|adub|calcari|palhada|consorcio|rotacao|crotalaria|mucuna|esterco|erosao|compost/.test(queryNorm)) return 'soil_management';
    if (/praga|lagarta|pulg|fungo|ferrugem|doenca|biologic|armadilha/.test(queryNorm)) return 'pest_ecology';
    if (/preco|mercad|vend|cooperativ|pnae|paa|custo|lucro|saca/.test(queryNorm)) return 'market';
    return 'general';
  }

  function buildMockAgronomicResearch(query, explicitCat) {
    var norm = typeof root.norm === 'function'
      ? root.norm(query || '')
      : String(query || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    var category = inferResearchCategory(norm, explicitCat);
    var telemetry = computePreliminarySatelliteMock();
    var crop = (root.A && root.A.crop) || telemetry.assumed_crop || 'lavoura';

    var findingsByCat = {
      satellite: {
        summary: 'Leitura satelital simulada da região aponta chuva recente de ' + telemetry.r30 + ' milímetros em 30 dias, umidade do solo SMAP em ' + telemetry.smap + ' (' + telemetry.soil_moisture_class + '), NDVI MODIS em ' + telemetry.ndvi + ' e evapotranspiração estimada de ' + telemetry.eto_mm_day + ' milímetros por dia.',
        recommendation: 'Priorize cobertura morta ou adubo verde para reduzir a evapotranspiração e conservar a água disponível na zona das raízes.',
        risks: 'Dados orbitais estimados em grade regional; microclimas e tipo de solo da propriedade alteram a retenção real de água.'
      },
      climate_zarc: {
        summary: 'A janela climática simulada mostra ' + telemetry.hot + ' dias acima de 35 graus no ano e risco hídrico estimado de ' + telemetry.ws + ' por cento para a região, exigindo atenção ao início firme das chuvas antes de semear ' + crop.toLowerCase() + '.',
        recommendation: 'Só semeie após umidade regular no solo superficial, alinhando a época de plantio ao Zoneamento Agrícola de Risco Climático da região.',
        risks: 'Plantar no seco ou antes de estabilizar a umidade aumenta o risco de falha de germinação por veranico.'
      },
      soil_management: {
        summary: 'Para ' + crop.toLowerCase() + ' com índice de degradação estimado em ' + telemetry.sd + ' por cento e declividade média de ' + telemetry.slope + ' por cento, práticas conservacionistas como plantio direto na palha, consórcio com leguminosas e curvas de nível fortalecem a estrutura do solo.',
        recommendation: 'Mantenha o solo sempre coberto com palhada ou leguminosas como feijão-de-porco e crotalária, e avalie análise química de solo antes de corrigir acidez ou adubação.',
        risks: 'Manejo sem proteção expõe a camada fértil à erosão e eleva a perda de nutrientes na primeira chuva forte.'
      },
      pest_ecology: {
        summary: 'O manejo ecológico integrado reduz pragas em ' + crop.toLowerCase() + ' por meio de rotação de culturas, diversificação com flores e leguminosas para atrair inimigos naturais e monitoramento frequente nas bordaduras.',
        recommendation: 'Evite repetir a mesma cultura na mesma área em safras seguidas e inspecione folhas jovens cedo pela manhã. Para qualquer produto químico ou receituário, procure sempre o técnico agrícola local.',
        risks: 'Sem identificação correta da praga e do nível de dano no campo, qualquer intervenção pode gerar gasto desnecessário ou desequilíbrio.'
      },
      market: {
        summary: 'Para fortalecer a renda em propriedades familiares, a diversificação entre cultura principal e uma segunda cultura de ciclo complementar reduz a dependência de um único preço de venda e abre acesso a programas locais e cooperativas.',
        recommendation: 'Combine o planejamento da safra com escoamento em feiras locais, cooperativas ou chamadas públicas como PNAE e PAA, escalonando a colheita quando possível.',
        risks: 'Preços oscilam bastante na safra cheia; armazenar corretamente e diversificar reduz a pressão para vender tudo na baixa.'
      },
      general: {
        summary: 'Análise consultiva simulada integrada aos indicadores regionais (umidade ' + telemetry.soil_moisture_class + ', chuva recente de ' + telemetry.r30 + ' milímetros e risco hídrico de ' + telemetry.ws + ' por cento) para apoiar sua tomada de decisão em ' + crop.toLowerCase() + '.',
        recommendation: 'Use práticas que conservam água e vida do solo, planeje em etapas pequenas e valide a aplicação específica com o técnico agrícola ou a extensão rural do município.',
        risks: 'Como são estimativas regionais simuladas, condições locais de solo e microclima devem ser conferidas em campo.'
      }
    };

    var chosen = findingsByCat[category] || findingsByCat.general;
    var payload = {
      ok: true,
      mock: true,
      is_preliminary_estimate: missingSlots().length > 0,
      category: category,
      query: String(query || '').slice(0, 140),
      indicators: telemetry,
      summary: chosen.summary,
      recommendation: chosen.recommendation,
      risks: chosen.risks,
      validation_note: 'Estimativa simulada para apoio à decisão; confirme com o técnico agrícola ou extensão rural local.'
    };

    if (root.SOLMemory && typeof root.SOLMemory.recordResearchNote === 'function') {
      root.SOLMemory.recordResearchNote(
        payload.query || ('pesquisa_' + category),
        category,
        chosen.summary,
        { r30: telemetry.r30, smap: telemetry.smap, ndvi: telemetry.ndvi, ws: telemetry.ws, sd: telemetry.sd }
      );
    }
    return payload;
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
        var utterNorm = norm(root._lastUserUtterance || '');
        var rawAreaArg = norm(String(a.area_ha));
        var hasExplicitUnit = /hectare|\bha\b|tarefa|metro|m2|alqueire/.test(rawAreaArg);
        var utterHasSpecialUnit = /tarefa|metro|m2|alqueire/.test(utterNorm);

        if (!hasExplicitUnit && utterHasSpecialUnit && typeof root.parseArea === 'function') {
          var fromUtter = root.parseArea(utterNorm);
          if (fromUtter != null && fromUtter > 0 && fromUtter < 1e5) {
            root.A.area = fromUtter;
            updated.push('area');
          }
        }
        if (updated.indexOf('area') === -1) {
          if (typeof a.area_ha === 'number' && a.area_ha > 0) {
            root.state = 'area';
            root.fill(norm(String(a.area_ha) + ' hectares'));
            if (root.A.area == null) root.A.area = a.area_ha;
            updated.push('area');
          } else {
            var parsed = typeof root.parseArea === 'function' ? root.parseArea(rawAreaArg) : null;
            if (parsed != null && parsed > 0 && parsed < 1e5) {
              root.A.area = parsed;
              updated.push('area');
            } else {
              root.state = 'area';
              if (root.fill(rawAreaArg).indexOf('area') !== -1) updated.push('area');
            }
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
      if (missing.length === 0) {
        var analysis = implementations.run_analysis();
        return Object.assign({ updated: updated, missing_slots: [] }, analysis);
      }
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
        var prelim = computePreliminarySatelliteMock();
        var missingSummary = 'Estimativa satelital preliminar da região: chuva recente de ' + prelim.r30 + ' milímetros em 30 dias, umidade do solo SMAP em ' + prelim.smap + ' (' + prelim.soil_moisture_class + ') e NDVI MODIS em ' + prelim.ndvi + '.';
        if (root.SOLMemory && typeof root.SOLMemory.recordResearchNote === 'function') {
          root.SOLMemory.recordResearchNote('analise_satelite_preliminar', 'satellite', missingSummary, prelim);
        }
        return {
          ok: true,
          mock: true,
          is_preliminary_estimate: true,
          missing_slots: missing,
          indicators: prelim,
          summary: missingSummary,
          validation_note: 'Estimativa preliminar simulada; para o plano personalizado com estimativa de produção, ainda falta informar: ' + missing.join(', ') + '.'
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
      var res = formatAnalysisResult();
      if (root.SOLMemory && typeof root.SOLMemory.saveContextSnapshot === 'function') {
        root.SOLMemory.saveContextSnapshot();
      }
      return res;
    },

    research_agronomic_mock: function (args) {
      var a = args || {};
      return buildMockAgronomicResearch(a.query || a.topic || root._lastUserUtterance || 'consulta agronômica', a.category || 'general');
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
      // Never fail or stall if the model calls an external/unregistered research or satellite tool name
      return buildMockAgronomicResearch(String(name || '') + ' ' + JSON.stringify(args || {}), 'general');
    }
    try {
      var result = fn(args || {});
      if (root.SOLMemory && typeof root.SOLMemory.saveContextSnapshot === 'function') {
        root.SOLMemory.saveContextSnapshot();
      }
      return result;
    } catch (err) {
      return buildMockAgronomicResearch('recuperacao_ferramenta_' + String(name || ''), 'general');
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
