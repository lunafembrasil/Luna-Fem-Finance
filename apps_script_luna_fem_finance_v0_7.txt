/*
Luna Fem Finance v0.4.4 - Painel Mobile Google Sheets
Compatível com Apps Script.

NOVIDADES:
- 1ª quinzena (1 a 15) e 2ª quinzena (16 ao fim) juntas.
- Espaços visuais entre análises.
- Uma única aba "Resumos Mensais", com o mês mais novo no topo.
- Resumos mensais dinâmicos: se uma venda antiga mudar, o resumo é recalculado.
- Ao começar um novo ano, cria "Resumo AAAA LFB" para cada ano concluído.
*/

var SECRET = "LUNA_FEM_2026";

var MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

var COLORS = {
  title: "#F28DCC",
  titleText: "#FFFFFF",
  section: "#F9D7EC",
  sectionText: "#8A245E",
  soft: "#FFF7FB",
  border: "#E8C7DA",
  negative: "#8A1F1F"
};

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: "Sem conteúdo recebido." });
    }

    var payload = JSON.parse(e.postData.contents);

    if (payload.secret !== SECRET) {
      return jsonResponse({ ok: false, error: "Chave secreta inválida." });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      return jsonResponse({ ok: false, error: "Planilha ativa não encontrada." });
    }

    updateConfigComissoes(ss, payload.sellers || [], payload.sales || []);
    updateResumoDoDia(ss, payload);
    updateVendas(ss, payload.sales || []);
    updateVendedores(ss, payload.summary && payload.summary.sellers ? payload.summary.sellers : []);
    updateCaixa(ss, payload);
    updateProdutosPendentes(ss, payload.pendingProducts || []);
    updateEstoqueBaixo(ss, payload.lowStock || []);
    updateAnalisesVisual(ss, payload.analyses || []);
    updateAnalisesVendedores(ss, payload.analyses || []);
    updateAnalisesPagamentos(ss, payload.analyses || []);
    updateQuinzenalVendedores(ss, payload.analyses || []);
    updateResumosMensais(ss, payload);
    updateResumosAnuais(ss, payload);
    updateLogs(ss, payload);
    updateDispositivos(ss, payload);

    return jsonResponse({ ok: true, updatedAt: new Date().toISOString() });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet() {
  return jsonResponse({
    ok: true,
    app: "Luna Fem Finance Painel Mobile",
    version: "0.7",
    message: "Web App ativo."
  });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function resetSheet(sh) {
  var range = sh.getDataRange();
  if (range) {
    try { range.breakApart(); } catch (e) {}
  }
  sh.clearContents();
  sh.clearFormats();
}

function ensureSize(sh, rows, cols) {
  if (sh.getMaxRows() < rows) {
    sh.insertRowsAfter(sh.getMaxRows(), rows - sh.getMaxRows());
  }
  if (sh.getMaxColumns() < cols) {
    sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
  }
}

function writeTable(ss, name, rows, frozenRows) {
  var sh = getSheet(ss, name);
  resetSheet(sh);

  if (!rows || rows.length === 0) rows = [["Sem dados"]];
  ensureSize(sh, rows.length, rows[0].length);

  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

  if (rows.length > 1) {
    sh.getRange(1, 1, 1, rows[0].length)
      .setFontWeight("bold")
      .setBackground(COLORS.section)
      .setFontColor(COLORS.sectionText);
    sh.setFrozenRows(frozenRows || 1);
    sh.autoResizeColumns(1, rows[0].length);
  }

  return sh;
}

function money(value) {
  return Number(value || 0);
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function parseSaleDate(sale) {
  if (sale && sale.date) {
    var parts = String(sale.date).split("/");
    if (parts.length === 3) {
      return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]), 12, 0, 0);
    }
  }

  if (sale && sale.createdAt) {
    var d = new Date(sale.createdAt);
    if (!isNaN(d.getTime())) return d;
  }

  return new Date(0);
}

function parseISODate(value) {
  if (!value) return new Date(0);
  var parts = String(value).split("-");
  if (parts.length === 3) {
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
  }
  return new Date(value);
}

function formatISODate(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1);
  var d = String(date.getDate());
  if (m.length < 2) m = "0" + m;
  if (d.length < 2) d = "0" + d;
  return y + "-" + m + "-" + d;
}

function dateBR(date) {
  var d = String(date.getDate());
  var m = String(date.getMonth() + 1);
  if (d.length < 2) d = "0" + d;
  if (m.length < 2) m = "0" + m;
  return d + "/" + m + "/" + date.getFullYear();
}

function monthKey(date) {
  var m = String(date.getMonth() + 1);
  if (m.length < 2) m = "0" + m;
  return date.getFullYear() + "-" + m;
}

function monthLabel(year, monthIndex) {
  return MONTHS_PT[monthIndex] + " " + year;
}

function validSales(sales) {
  var out = [];
  for (var i = 0; i < sales.length; i++) {
    if (!sales[i].cancelled) out.push(sales[i]);
  }
  return out;
}

function cancelledSales(sales) {
  var out = [];
  for (var i = 0; i < sales.length; i++) {
    if (sales[i].cancelled) out.push(sales[i]);
  }
  return out;
}

function salesInRange(sales, start, end, includeCancelled) {
  var out = [];
  var startTime = start.getTime();
  var endTime = end.getTime();

  for (var i = 0; i < sales.length; i++) {
    if (!includeCancelled && sales[i].cancelled) continue;
    var t = parseSaleDate(sales[i]).getTime();
    if (t >= startTime && t <= endTime) out.push(sales[i]);
  }

  return out;
}

function metricSummary(sales) {
  var result = {
    count: 0,
    subtotal: 0,
    discount: 0,
    total: 0,
    cost: 0,
    fee: 0,
    profit: 0
  };

  for (var i = 0; i < sales.length; i++) {
    var s = sales[i];
    result.count += 1;
    result.subtotal += money(s.subtotal || s.total);
    result.discount += money(s.discountAmount);
    result.total += money(s.total);
    result.cost += money(s.cost);
    result.fee += money(s.fee);
    result.profit += money(s.profit);
  }

  return result;
}

function paymentSummary(sales) {
  var result = {
    dinheiro: 0,
    pix: 0,
    debito: 0,
    credito: 0,
    transferencia: 0,
    misto: 0
  };

  for (var i = 0; i < sales.length; i++) {
    var s = sales[i];
    var key = normalizeText(s.paymentKey || s.payment);

    if (key === "misto" || key.indexOf("misto") >= 0) {
      var mixed = s.mixed || {};
      result.dinheiro += money(mixed.dinheiro);
      result.pix += money(mixed.pix);
      result.debito += money(mixed.debito);
      result.credito += money(mixed.credito);
      result.transferencia += money(mixed.transferencia);
      result.misto += money(s.total);
    } else if (key.indexOf("dinheiro") >= 0) {
      result.dinheiro += money(s.total);
    } else if (key.indexOf("pix") >= 0) {
      result.pix += money(s.total);
    } else if (key.indexOf("débito") >= 0 || key.indexOf("debito") >= 0) {
      result.debito += money(s.total);
    } else if (key.indexOf("crédito") >= 0 || key.indexOf("credito") >= 0) {
      result.credito += money(s.total);
    } else if (key.indexOf("transfer") >= 0) {
      result.transferencia += money(s.total);
    }
  }

  return result;
}

function sellerSummaryFromSales(sales) {
  var map = {};

  for (var i = 0; i < sales.length; i++) {
    var s = sales[i];
    var key = String(s.sellerNumber || s.sellerName || "0");

    if (!map[key]) {
      map[key] = {
        number: s.sellerNumber || "",
        name: s.sellerName || "Não informado",
        count: 0,
        total: 0,
        profit: 0
      };
    }

    map[key].count += 1;
    map[key].total += money(s.total);
    map[key].profit += money(s.profit);
  }

  var out = [];
  for (var k in map) {
    if (map.hasOwnProperty(k)) out.push(map[k]);
  }

  out.sort(function(a, b) {
    return money(b.total) - money(a.total);
  });

  return out;
}

function productSummary(sales) {
  var map = {};

  for (var i = 0; i < sales.length; i++) {
    var items = sales[i].items || [];

    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      var key = String(item.productId || item.name || "sem-produto");

      if (!map[key]) {
        map[key] = {
          name: item.name || "Produto sem nome",
          qty: 0,
          revenue: 0
        };
      }

      map[key].qty += money(item.qty);
      map[key].revenue += money(item.price) * money(item.qty);
    }
  }

  var out = [];
  for (var k in map) {
    if (map.hasOwnProperty(k)) out.push(map[k]);
  }

  out.sort(function(a, b) {
    if (money(b.qty) !== money(a.qty)) return money(b.qty) - money(a.qty);
    return money(b.revenue) - money(a.revenue);
  });

  return out;
}

function getCommissionRates(ss) {
  var rates = {};
  var sh = ss.getSheetByName("Config Comissões");

  if (!sh || sh.getLastRow() < 2) return rates;

  var values = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();

  for (var i = 0; i < values.length; i++) {
    var number = String(values[i][0] || "");
    if (number) rates[number] = Number(values[i][2] || 0);
  }

  return rates;
}

function updateConfigComissoes(ss, sellers, sales) {
  var existingRates = getCommissionRates(ss);
  var map = {};

  for (var i = 0; i < sellers.length; i++) {
    map[String(sellers[i].number || sellers[i].name)] = {
      number: sellers[i].number || "",
      name: sellers[i].name || ""
    };
  }

  for (var j = 0; j < sales.length; j++) {
    var sale = sales[j];
    var key = String(sale.sellerNumber || sale.sellerName || "");
    if (key && !map[key]) {
      map[key] = {
        number: sale.sellerNumber || "",
        name: sale.sellerName || ""
      };
    }
  }

  var rows = [["Vendedor Nº", "Vendedor", "Comissão %"]];
  var list = [];

  for (var k in map) {
    if (map.hasOwnProperty(k)) list.push(map[k]);
  }

  list.sort(function(a, b) {
    return Number(a.number || 999) - Number(b.number || 999);
  });

  for (var n = 0; n < list.length; n++) {
    var seller = list[n];
    var rateKey = String(seller.number || seller.name || "");
    rows.push([
      seller.number || "",
      seller.name || "",
      existingRates.hasOwnProperty(rateKey) ? existingRates[rateKey] : 0
    ]);
  }

  var sh = writeTable(ss, "Config Comissões", rows, 1);

  if (rows.length > 1) {
    sh.getRange(2, 3, rows.length - 1, 1).setNumberFormat('0.00"%"');
  }

  sh.getRange("E1").setValue("Instrução");
  sh.getRange("E2").setValue("Edite apenas a coluna Comissão %. O valor será usado nos resumos quinzenais, mensais e anuais.");
  sh.getRange("E1").setFontWeight("bold").setBackground(COLORS.section).setFontColor(COLORS.sectionText);
  sh.autoResizeColumn(5);
}

function updateResumoDoDia(ss, payload) {
  var s = payload.summary || {};
  var payments = s.payments || {};
  var cash = s.cash || {};

  var rows = [
    ["Luna Fem Finance - Resumo do Dia", ""],
    ["Última sincronização", payload.sentAt || ""],
    ["Motivo", payload.reason || ""],
    ["Data", s.dateISO || ""],
    ["", ""],
    ["Total vendido hoje", money(s.total)],
    ["Lucro estimado hoje", money(s.profit)],
    ["Custo estimado hoje", money(s.cost)],
    ["Quantidade de vendas", money(s.count)],
    ["", ""],
    ["Dinheiro", money(payments.dinheiro)],
    ["PIX", money(payments.pix)],
    ["Débito", money(payments.debito)],
    ["Crédito", money(payments.credito)],
    ["Transferência", money(payments.transferencia)],
    ["Misto", money(payments.misto)],
    ["", ""],
    ["Caixa aberto?", cash.open ? "Sim" : "Não"],
    ["Aberto em", cash.openedAt || ""],
    ["Valor inicial", money(cash.initial)],
    ["Dinheiro esperado", money(cash.expectedCash)],
    ["Vendas em dinheiro", money(cash.cashSales)],
    ["Entradas/retiradas manuais", money(cash.manualMovements)]
  ];

  var sh = writeTable(ss, "Resumo do Dia", rows, 0);
  sh.getRange("B6:B15").setNumberFormat('"R$" #,##0.00');
  sh.getRange("B20:B23").setNumberFormat('"R$" #,##0.00');
  sh.getRange("A1:B1").merge().setFontSize(16).setFontWeight("bold").setBackground(COLORS.title).setFontColor(COLORS.titleText);
}

function updateVendas(ss, sales) {
  var rows = [[
    "Data", "Hora", "Data/Hora", "Vendedor Nº", "Vendedor", "Cliente", "Telefone",
    "Pagamento", "Parcelas", "Subtotal", "Desconto %", "Desconto R$", "Total final",
    "Custo", "Taxa", "Lucro", "Cancelada", "Itens"
  ]];

  for (var i = 0; i < sales.length; i++) {
    var s = sales[i];
    rows.push([
      s.date || "",
      s.time || "",
      s.createdAt || "",
      s.sellerNumber || "",
      s.sellerName || "",
      s.customer || "",
      s.phone || "",
      s.payment || "",
      s.installments || "",
      money(s.subtotal || s.total),
      money(s.discountPercent),
      money(s.discountAmount),
      money(s.total),
      money(s.cost),
      money(s.fee),
      money(s.profit),
      s.cancelled ? "Sim" : "Não",
      s.itemsText || ""
    ]);
  }

  var sh = writeTable(ss, "Vendas", rows, 1);

  if (rows.length > 1) {
    sh.getRange(2, 10, rows.length - 1, 7).setNumberFormat('"R$" #,##0.00');
  }
}

function updateVendedores(ss, sellers) {
  var rows = [["Vendedor Nº", "Vendedor", "Quantidade de vendas", "Total vendido", "Lucro estimado"]];

  for (var i = 0; i < sellers.length; i++) {
    var s = sellers[i];
    rows.push([
      s.number || "",
      s.name || "",
      money(s.count),
      money(s.total),
      money(s.profit)
    ]);
  }

  var sh = writeTable(ss, "Vendedores", rows, 1);

  if (rows.length > 1) {
    sh.getRange(2, 4, rows.length - 1, 2).setNumberFormat('"R$" #,##0.00');
  }
}

function updateCaixa(ss, payload) {
  var rows = [[
    "Data", "Abertura", "Fechamento", "Valor inicial", "Vendas em dinheiro",
    "Entradas/Retiradas", "Esperado", "Contado", "Diferença", "Aberto por", "Fechado por"
  ]];

  var sessions = payload.cashSessions || [];

  for (var i = 0; i < sessions.length; i++) {
    var c = sessions[i];
    rows.push([
      c.dateISO || "",
      c.openedAt || "",
      c.closedAt || "",
      money(c.initial),
      money(c.cashSales),
      money(c.manualMovements),
      money(c.expectedCash),
      money(c.closingAmount),
      money(c.difference),
      c.openedBy || "",
      c.closedBy || ""
    ]);
  }

  var sh = writeTable(ss, "Caixa", rows, 1);

  if (rows.length > 1) {
    sh.getRange(2, 4, rows.length - 1, 6).setNumberFormat('"R$" #,##0.00');
  }
}

function updateProdutosPendentes(ss, products) {
  var rows = [["Criado em", "Produto", "Categoria", "Preço venda", "Criado por", "Observação"]];

  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    rows.push([
      p.createdAt || "",
      p.name || "",
      p.category || "",
      money(p.price),
      p.createdBy || "",
      p.note || ""
    ]);
  }

  var sh = writeTable(ss, "Produtos Pendentes", rows, 1);

  if (rows.length > 1) {
    sh.getRange(2, 4, rows.length - 1, 1).setNumberFormat('"R$" #,##0.00');
  }
}

function updateEstoqueBaixo(ss, products) {
  var rows = [["Produto", "Categoria", "Estoque", "Preço venda", "Código"]];

  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    rows.push([
      p.name || "",
      p.category || "",
      money(p.stock),
      money(p.price),
      p.sku || ""
    ]);
  }

  var sh = writeTable(ss, "Estoque Baixo", rows, 1);

  if (rows.length > 1) {
    sh.getRange(2, 4, rows.length - 1, 1).setNumberFormat('"R$" #,##0.00');
  }
}

function updateAnalisesVisual(ss, analyses) {
  var sh = getSheet(ss, "Análises");
  resetSheet(sh);

  var row = 1;
  ensureSize(sh, Math.max(60, analyses.length * 16), 4);

  sh.getRange(row, 1, 1, 4).merge()
    .setValue("Luna Fem Finance - Análises")
    .setFontSize(16)
    .setFontWeight("bold")
    .setBackground(COLORS.title)
    .setFontColor(COLORS.titleText);
  row += 2;

  for (var i = 0; i < analyses.length; i++) {
    var a = analyses[i];

    sh.getRange(row, 1, 1, 4).merge()
      .setValue(a.label || "Período")
      .setFontWeight("bold")
      .setBackground(COLORS.section)
      .setFontColor(COLORS.sectionText);
    row++;

    var block = [
      ["Início", a.startISO || "", "Fim", a.endISO || ""],
      ["Quantidade de vendas", money(a.count), "Subtotal", money(a.subtotal)],
      ["Desconto", money(a.discount), "Total vendido", money(a.total)],
      ["Custo", money(a.cost), "Taxas", money(a.fee)],
      ["Lucro", money(a.profit), "", ""]
    ];

    sh.getRange(row, 1, block.length, 4).setValues(block);
    sh.getRange(row + 1, 2, 4, 1).setNumberFormat('"R$" #,##0.00');
    sh.getRange(row + 1, 4, 3, 1).setNumberFormat('"R$" #,##0.00');
    sh.getRange(row, 1, block.length, 4).setBorder(true, true, true, true, true, true, COLORS.border, SpreadsheetApp.BorderStyle.SOLID);
    row += block.length + 2;
  }

  sh.setFrozenRows(1);
  sh.setColumnWidths(1, 4, 155);
  sh.getRange(1, 1, row, 4).setVerticalAlignment("middle");
}

function updateAnalisesVendedores(ss, analyses) {
  var rows = [["Período", "Vendedor Nº", "Vendedor", "Qtd. vendas", "Total vendido", "Lucro estimado"]];

  for (var i = 0; i < analyses.length; i++) {
    var a = analyses[i];
    var sellers = a.sellers || [];

    for (var j = 0; j < sellers.length; j++) {
      var s = sellers[j];
      rows.push([
        a.label || "",
        s.number || "",
        s.name || "",
        money(s.count),
        money(s.total),
        money(s.profit)
      ]);
    }
  }

  var sh = writeTable(ss, "Análises Vendedores", rows, 1);

  if (rows.length > 1) {
    sh.getRange(2, 5, rows.length - 1, 2).setNumberFormat('"R$" #,##0.00');
  }
}

function updateAnalisesPagamentos(ss, analyses) {
  var rows = [["Período", "Dinheiro", "PIX", "Débito", "Crédito", "Transferência", "Misto"]];

  for (var i = 0; i < analyses.length; i++) {
    var a = analyses[i];
    var p = a.payments || {};

    rows.push([
      a.label || "",
      money(p.dinheiro),
      money(p.pix),
      money(p.debito),
      money(p.credito),
      money(p.transferencia),
      money(p.misto)
    ]);
  }

  var sh = writeTable(ss, "Análises Pagamentos", rows, 1);

  if (rows.length > 1) {
    sh.getRange(2, 2, rows.length - 1, 6).setNumberFormat('"R$" #,##0.00');
  }
}

function updateQuinzenalVendedores(ss, analyses) {
  var sh = getSheet(ss, "Quinzenal Vendedores");
  resetSheet(sh);
  ensureSize(sh, 80, 10);

  var rates = getCommissionRates(ss);
  var row = 1;

  sh.getRange(row, 1, 1, 10).merge()
    .setValue("Luna Fem Finance - Resumo Quinzenal por Vendedor")
    .setFontSize(16)
    .setFontWeight("bold")
    .setBackground(COLORS.title)
    .setFontColor(COLORS.titleText);
  row += 2;

  var types = ["quinzena_1", "quinzena_2"];

  for (var t = 0; t < types.length; t++) {
    var analysis = null;

    for (var i = 0; i < analyses.length; i++) {
      if (analyses[i].type === types[t]) {
        analysis = analyses[i];
        break;
      }
    }

    if (!analysis) continue;

    sh.getRange(row, 1, 1, 10).merge()
      .setValue((analysis.label || "Quinzena") + " | " + (analysis.startISO || "") + " até " + (analysis.endISO || ""))
      .setFontWeight("bold")
      .setBackground(COLORS.section)
      .setFontColor(COLORS.sectionText);
    row++;

    var header = [[
      "Vendedor Nº", "Vendedor", "Qtd. vendas", "Total vendido", "Lucro estimado",
      "Comissão %", "Comissão estimada", "Início", "Fim", "Período"
    ]];

    sh.getRange(row, 1, 1, 10).setValues(header)
      .setFontWeight("bold")
      .setBackground(COLORS.soft);
    row++;

    var sellers = analysis.sellers || [];

    if (sellers.length === 0) {
      sh.getRange(row, 1).setValue("Sem vendas neste período.");
      row++;
    } else {
      var data = [];

      for (var j = 0; j < sellers.length; j++) {
        var s = sellers[j];
        var key = String(s.number || s.name || "");
        var rate = rates.hasOwnProperty(key) ? money(rates[key]) : 0;
        var commission = money(s.total) * rate / 100;

        data.push([
          s.number || "",
          s.name || "",
          money(s.count),
          money(s.total),
          money(s.profit),
          rate,
          commission,
          analysis.startISO || "",
          analysis.endISO || "",
          analysis.label || ""
        ]);
      }

      sh.getRange(row, 1, data.length, 10).setValues(data);
      sh.getRange(row, 4, data.length, 2).setNumberFormat('"R$" #,##0.00');
      sh.getRange(row, 6, data.length, 1).setNumberFormat('0.00"%"');
      sh.getRange(row, 7, data.length, 1).setNumberFormat('"R$" #,##0.00');
      row += data.length;
    }

    row += 3;
  }

  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, 10);
}

function cashSummaryForMonth(sessions, year, monthIndex) {
  var result = {
    sessions: 0,
    initial: 0,
    expected: 0,
    counted: 0,
    difference: 0
  };

  for (var i = 0; i < sessions.length; i++) {
    var c = sessions[i];
    var d = parseISODate(c.dateISO);

    if (d.getFullYear() === year && d.getMonth() === monthIndex) {
      result.sessions += 1;
      result.initial += money(c.initial);
      result.expected += money(c.expectedCash);
      result.counted += money(c.closingAmount);
      result.difference += money(c.difference);
    }
  }

  return result;
}

function getCompletedMonths(sales) {
  var current = new Date();
  var currentMonthStart = new Date(current.getFullYear(), current.getMonth(), 1);
  var map = {};

  for (var i = 0; i < sales.length; i++) {
    var d = parseSaleDate(sales[i]);
    var monthStart = new Date(d.getFullYear(), d.getMonth(), 1);

    if (monthStart.getTime() < currentMonthStart.getTime()) {
      var key = monthKey(d);
      map[key] = {
        key: key,
        year: d.getFullYear(),
        month: d.getMonth()
      };
    }
  }

  var list = [];
  for (var k in map) {
    if (map.hasOwnProperty(k)) list.push(map[k]);
  }

  list.sort(function(a, b) {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });

  return list;
}

function writeSectionHeader(sh, row, title, cols) {
  sh.getRange(row, 1, 1, cols).merge()
    .setValue(title)
    .setFontWeight("bold")
    .setBackground(COLORS.section)
    .setFontColor(COLORS.sectionText);
}

function updateResumosMensais(ss, payload) {
  var sh = getSheet(ss, "Resumos Mensais");
  resetSheet(sh);

  var sales = payload.sales || [];
  var sessions = payload.cashSessions || [];
  var months = getCompletedMonths(sales);
  var rates = getCommissionRates(ss);

  ensureSize(sh, Math.max(120, months.length * 70), 8);

  var row = 1;

  sh.getRange(row, 1, 1, 8).merge()
    .setValue("Luna Fem Finance - Resumos Mensais")
    .setFontSize(16)
    .setFontWeight("bold")
    .setBackground(COLORS.title)
    .setFontColor(COLORS.titleText);
  row += 2;

  sh.getRange(row, 1, 1, 8).merge()
    .setValue("Os meses concluídos são recalculados automaticamente. O mês mais novo aparece primeiro.")
    .setBackground(COLORS.soft);
  row += 2;

  if (months.length === 0) {
    sh.getRange(row, 1, 1, 8).merge()
      .setValue("Ainda não há um mês concluído com vendas para exibir.");
    sh.autoResizeColumns(1, 8);
    return;
  }

  for (var m = 0; m < months.length; m++) {
    var info = months[m];
    var start = new Date(info.year, info.month, 1, 0, 0, 0);
    var end = new Date(info.year, info.month + 1, 0, 23, 59, 59);

    var allMonthSales = salesInRange(sales, start, end, true);
    var validMonthSales = validSales(allMonthSales);
    var cancelledMonthSales = cancelledSales(allMonthSales);
    var metrics = metricSummary(validMonthSales);
    var payments = paymentSummary(validMonthSales);
    var sellers = sellerSummaryFromSales(validMonthSales);
    var products = productSummary(validMonthSales);
    var cash = cashSummaryForMonth(sessions, info.year, info.month);

    var firstStart = new Date(info.year, info.month, 1, 0, 0, 0);
    var firstEnd = new Date(info.year, info.month, 15, 23, 59, 59);
    var secondStart = new Date(info.year, info.month, 16, 0, 0, 0);
    var secondEnd = end;

    var firstMetrics = metricSummary(salesInRange(sales, firstStart, firstEnd, false));
    var secondMetrics = metricSummary(salesInRange(sales, secondStart, secondEnd, false));

    sh.getRange(row, 1, 1, 8).merge()
      .setValue("Resumo " + monthLabel(info.year, info.month))
      .setFontSize(15)
      .setFontWeight("bold")
      .setBackground(COLORS.title)
      .setFontColor(COLORS.titleText);
    row += 2;

    writeSectionHeader(sh, row, "Resumo Geral", 8);
    row++;

    var general = [
      ["Período", dateBR(start) + " até " + dateBR(end), "Qtd. vendas", metrics.count, "Canceladas", cancelledMonthSales.length, "", ""],
      ["Subtotal", metrics.subtotal, "Descontos", metrics.discount, "Total vendido", metrics.total, "", ""],
      ["Custo", metrics.cost, "Taxas", metrics.fee, "Lucro", metrics.profit, "", ""]
    ];

    sh.getRange(row, 1, general.length, 8).setValues(general);
    sh.getRange(row + 1, 2, 2, 1).setNumberFormat('"R$" #,##0.00');
    sh.getRange(row + 1, 4, 2, 1).setNumberFormat('"R$" #,##0.00');
    sh.getRange(row + 1, 6, 2, 1).setNumberFormat('"R$" #,##0.00');
    row += general.length + 2;

    writeSectionHeader(sh, row, "Quinzenas", 8);
    row++;

    var quinzenas = [
      ["Período", "Qtd. vendas", "Subtotal", "Desconto", "Total vendido", "Custo", "Taxas", "Lucro"],
      ["1ª Quinzena (1–15)", firstMetrics.count, firstMetrics.subtotal, firstMetrics.discount, firstMetrics.total, firstMetrics.cost, firstMetrics.fee, firstMetrics.profit],
      ["2ª Quinzena (16–fim)", secondMetrics.count, secondMetrics.subtotal, secondMetrics.discount, secondMetrics.total, secondMetrics.cost, secondMetrics.fee, secondMetrics.profit]
    ];

    sh.getRange(row, 1, quinzenas.length, 8).setValues(quinzenas);
    sh.getRange(row, 1, 1, 8).setFontWeight("bold").setBackground(COLORS.soft);
    sh.getRange(row + 1, 3, 2, 6).setNumberFormat('"R$" #,##0.00');
    row += quinzenas.length + 2;

    writeSectionHeader(sh, row, "Formas de Pagamento", 8);
    row++;

    var paymentRows = [
      ["Dinheiro", payments.dinheiro, "PIX", payments.pix, "Débito", payments.debito, "", ""],
      ["Crédito", payments.credito, "Transferência", payments.transferencia, "Misto", payments.misto, "", ""]
    ];

    sh.getRange(row, 1, paymentRows.length, 8).setValues(paymentRows);
    sh.getRange(row, 2, paymentRows.length, 1).setNumberFormat('"R$" #,##0.00');
    sh.getRange(row, 4, paymentRows.length, 1).setNumberFormat('"R$" #,##0.00');
    sh.getRange(row, 6, paymentRows.length, 1).setNumberFormat('"R$" #,##0.00');
    row += paymentRows.length + 2;

    writeSectionHeader(sh, row, "Vendas por Vendedor e Comissões", 8);
    row++;

    sh.getRange(row, 1, 1, 8).setValues([[
      "Vendedor Nº", "Vendedor", "Qtd. vendas", "Total vendido",
      "Lucro estimado", "Comissão %", "Comissão estimada", ""
    ]]).setFontWeight("bold").setBackground(COLORS.soft);
    row++;

    if (sellers.length === 0) {
      sh.getRange(row, 1).setValue("Sem vendas.");
      row++;
    } else {
      var sellerRows = [];

      for (var s = 0; s < sellers.length; s++) {
        var seller = sellers[s];
        var rateKey = String(seller.number || seller.name || "");
        var rate = rates.hasOwnProperty(rateKey) ? money(rates[rateKey]) : 0;

        sellerRows.push([
          seller.number || "",
          seller.name || "",
          seller.count,
          seller.total,
          seller.profit,
          rate,
          seller.total * rate / 100,
          ""
        ]);
      }

      sh.getRange(row, 1, sellerRows.length, 8).setValues(sellerRows);
      sh.getRange(row, 4, sellerRows.length, 2).setNumberFormat('"R$" #,##0.00');
      sh.getRange(row, 6, sellerRows.length, 1).setNumberFormat('0.00"%"');
      sh.getRange(row, 7, sellerRows.length, 1).setNumberFormat('"R$" #,##0.00');
      row += sellerRows.length;
    }

    row += 2;

    writeSectionHeader(sh, row, "Caixa do Mês", 8);
    row++;

    var cashRows = [
      ["Sessões de caixa", cash.sessions, "Total inicial", cash.initial, "Total esperado", cash.expected, "", ""],
      ["Total contado", cash.counted, "Diferença acumulada", cash.difference, "", "", "", ""]
    ];

    sh.getRange(row, 1, cashRows.length, 8).setValues(cashRows);
    sh.getRange(row, 4, 1, 1).setNumberFormat('"R$" #,##0.00');
    sh.getRange(row, 6, 1, 1).setNumberFormat('"R$" #,##0.00');
    sh.getRange(row + 1, 2, 1, 1).setNumberFormat('"R$" #,##0.00');
    sh.getRange(row + 1, 4, 1, 1).setNumberFormat('"R$" #,##0.00');
    row += cashRows.length + 2;

    writeSectionHeader(sh, row, "Produtos Mais Vendidos", 8);
    row++;

    sh.getRange(row, 1, 1, 4).setValues([["Posição", "Produto", "Quantidade", "Receita bruta"]])
      .setFontWeight("bold")
      .setBackground(COLORS.soft);
    row++;

    var limit = Math.min(products.length, 10);

    if (limit === 0) {
      sh.getRange(row, 1).setValue("Sem produtos para listar.");
      row++;
    } else {
      var productRows = [];

      for (var p = 0; p < limit; p++) {
        productRows.push([p + 1, products[p].name, products[p].qty, products[p].revenue]);
      }

      sh.getRange(row, 1, productRows.length, 4).setValues(productRows);
      sh.getRange(row, 4, productRows.length, 1).setNumberFormat('"R$" #,##0.00');
      row += productRows.length;
    }

    row += 4;
  }

  sh.setFrozenRows(1);
  sh.setColumnWidths(1, 8, 135);
  sh.getRange(1, 1, row, 8).setVerticalAlignment("middle");
}

function getCompletedYears(sales) {
  var currentYear = new Date().getFullYear();
  var map = {};

  for (var i = 0; i < sales.length; i++) {
    var d = parseSaleDate(sales[i]);
    var year = d.getFullYear();

    if (year > 2000 && year < currentYear) {
      map[String(year)] = year;
    }
  }

  var years = [];
  for (var k in map) {
    if (map.hasOwnProperty(k)) years.push(map[k]);
  }

  years.sort(function(a, b) { return b - a; });
  return years;
}

function updateResumosAnuais(ss, payload) {
  var sales = payload.sales || [];
  var years = getCompletedYears(sales);
  var rates = getCommissionRates(ss);

  for (var y = 0; y < years.length; y++) {
    writeAnnualSummary(ss, years[y], sales, rates);
  }
}

function writeAnnualSummary(ss, year, allSales, rates) {
  var sheetName = "Resumo " + year + " LFB";
  var sh = getSheet(ss, sheetName);
  resetSheet(sh);
  ensureSize(sh, 180, 8);

  var start = new Date(year, 0, 1, 0, 0, 0);
  var end = new Date(year, 11, 31, 23, 59, 59);
  var yearAll = salesInRange(allSales, start, end, true);
  var yearSales = validSales(yearAll);
  var cancelled = cancelledSales(yearAll);
  var metrics = metricSummary(yearSales);
  var payments = paymentSummary(yearSales);
  var sellers = sellerSummaryFromSales(yearSales);
  var products = productSummary(yearSales);

  var row = 1;

  sh.getRange(row, 1, 1, 8).merge()
    .setValue("Resumo " + year + " LFB")
    .setFontSize(17)
    .setFontWeight("bold")
    .setBackground(COLORS.title)
    .setFontColor(COLORS.titleText);
  row += 2;

  sh.getRange(row, 1, 1, 8).merge()
    .setValue("Resumo anual dinâmico. Qualquer correção realizada nas vendas será refletida na próxima sincronização.")
    .setBackground(COLORS.soft);
  row += 2;

  writeSectionHeader(sh, row, "Resumo Geral do Ano", 8);
  row++;

  var general = [
    ["Período", "01/01/" + year + " até 31/12/" + year, "Qtd. vendas", metrics.count, "Canceladas", cancelled.length, "", ""],
    ["Subtotal", metrics.subtotal, "Descontos", metrics.discount, "Total vendido", metrics.total, "", ""],
    ["Custo", metrics.cost, "Taxas", metrics.fee, "Lucro", metrics.profit, "", ""]
  ];

  sh.getRange(row, 1, general.length, 8).setValues(general);
  sh.getRange(row + 1, 2, 2, 1).setNumberFormat('"R$" #,##0.00');
  sh.getRange(row + 1, 4, 2, 1).setNumberFormat('"R$" #,##0.00');
  sh.getRange(row + 1, 6, 2, 1).setNumberFormat('"R$" #,##0.00');
  row += general.length + 2;

  writeSectionHeader(sh, row, "Desempenho Mensal", 8);
  row++;

  sh.getRange(row, 1, 1, 8).setValues([[
    "Mês", "Qtd. vendas", "Subtotal", "Desconto", "Total vendido", "Custo", "Taxas", "Lucro"
  ]]).setFontWeight("bold").setBackground(COLORS.soft);
  row++;

  var monthRows = [];

  for (var m = 0; m < 12; m++) {
    var monthStart = new Date(year, m, 1, 0, 0, 0);
    var monthEnd = new Date(year, m + 1, 0, 23, 59, 59);
    var mm = metricSummary(salesInRange(allSales, monthStart, monthEnd, false));

    monthRows.push([
      MONTHS_PT[m],
      mm.count,
      mm.subtotal,
      mm.discount,
      mm.total,
      mm.cost,
      mm.fee,
      mm.profit
    ]);
  }

  sh.getRange(row, 1, monthRows.length, 8).setValues(monthRows);
  sh.getRange(row, 3, monthRows.length, 6).setNumberFormat('"R$" #,##0.00');
  row += monthRows.length + 2;

  writeSectionHeader(sh, row, "Quinzenas do Ano", 8);
  row++;

  sh.getRange(row, 1, 1, 8).setValues([[
    "Mês", "Quinzena", "Qtd. vendas", "Subtotal", "Desconto", "Total vendido", "Custo", "Lucro"
  ]]).setFontWeight("bold").setBackground(COLORS.soft);
  row++;

  var fortnightRows = [];

  for (var qMonth = 0; qMonth < 12; qMonth++) {
    var q1 = metricSummary(salesInRange(
      allSales,
      new Date(year, qMonth, 1, 0, 0, 0),
      new Date(year, qMonth, 15, 23, 59, 59),
      false
    ));

    var q2 = metricSummary(salesInRange(
      allSales,
      new Date(year, qMonth, 16, 0, 0, 0),
      new Date(year, qMonth + 1, 0, 23, 59, 59),
      false
    ));

    fortnightRows.push([
      MONTHS_PT[qMonth], "1ª (1–15)", q1.count, q1.subtotal, q1.discount, q1.total, q1.cost, q1.profit
    ]);

    fortnightRows.push([
      MONTHS_PT[qMonth], "2ª (16–fim)", q2.count, q2.subtotal, q2.discount, q2.total, q2.cost, q2.profit
    ]);
  }

  sh.getRange(row, 1, fortnightRows.length, 8).setValues(fortnightRows);
  sh.getRange(row, 4, fortnightRows.length, 5).setNumberFormat('"R$" #,##0.00');
  row += fortnightRows.length + 2;

  writeSectionHeader(sh, row, "Vendas por Vendedor e Comissões", 8);
  row++;

  sh.getRange(row, 1, 1, 8).setValues([[
    "Vendedor Nº", "Vendedor", "Qtd. vendas", "Total vendido", "Lucro estimado", "Comissão %", "Comissão estimada", ""
  ]]).setFontWeight("bold").setBackground(COLORS.soft);
  row++;

  if (sellers.length > 0) {
    var sellerRows = [];

    for (var s = 0; s < sellers.length; s++) {
      var seller = sellers[s];
      var key = String(seller.number || seller.name || "");
      var rate = rates.hasOwnProperty(key) ? money(rates[key]) : 0;

      sellerRows.push([
        seller.number || "",
        seller.name || "",
        seller.count,
        seller.total,
        seller.profit,
        rate,
        seller.total * rate / 100,
        ""
      ]);
    }

    sh.getRange(row, 1, sellerRows.length, 8).setValues(sellerRows);
    sh.getRange(row, 4, sellerRows.length, 2).setNumberFormat('"R$" #,##0.00');
    sh.getRange(row, 6, sellerRows.length, 1).setNumberFormat('0.00"%"');
    sh.getRange(row, 7, sellerRows.length, 1).setNumberFormat('"R$" #,##0.00');
    row += sellerRows.length;
  } else {
    sh.getRange(row, 1).setValue("Sem vendas.");
    row++;
  }

  row += 2;

  writeSectionHeader(sh, row, "Formas de Pagamento", 8);
  row++;

  var paymentRows = [
    ["Dinheiro", payments.dinheiro, "PIX", payments.pix, "Débito", payments.debito, "", ""],
    ["Crédito", payments.credito, "Transferência", payments.transferencia, "Misto", payments.misto, "", ""]
  ];

  sh.getRange(row, 1, paymentRows.length, 8).setValues(paymentRows);
  sh.getRange(row, 2, paymentRows.length, 1).setNumberFormat('"R$" #,##0.00');
  sh.getRange(row, 4, paymentRows.length, 1).setNumberFormat('"R$" #,##0.00');
  sh.getRange(row, 6, paymentRows.length, 1).setNumberFormat('"R$" #,##0.00');
  row += paymentRows.length + 2;

  writeSectionHeader(sh, row, "Produtos Mais Vendidos do Ano", 8);
  row++;

  sh.getRange(row, 1, 1, 4).setValues([["Posição", "Produto", "Quantidade", "Receita bruta"]])
    .setFontWeight("bold")
    .setBackground(COLORS.soft);
  row++;

  var limit = Math.min(products.length, 20);

  if (limit > 0) {
    var productRows = [];

    for (var p = 0; p < limit; p++) {
      productRows.push([p + 1, products[p].name, products[p].qty, products[p].revenue]);
    }

    sh.getRange(row, 1, productRows.length, 4).setValues(productRows);
    sh.getRange(row, 4, productRows.length, 1).setNumberFormat('"R$" #,##0.00');
    row += productRows.length;
  } else {
    sh.getRange(row, 1).setValue("Sem produtos para listar.");
    row++;
  }

  sh.setFrozenRows(1);
  sh.setColumnWidths(1, 8, 135);
  sh.getRange(1, 1, row, 8).setVerticalAlignment("middle");
}

function updateLogs(ss, payload) {
  var sh = getSheet(ss, "Logs");

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 6)
      .setValues([["Recebido em", "Motivo", "Enviado em", "Qtd. vendas", "Computador", "Versão"]])
      .setFontWeight("bold")
      .setBackground(COLORS.section);
  }

  sh.appendRow([
    new Date(),
    payload.reason || "",
    payload.sentAt || "",
    payload.sales ? payload.sales.length : 0,
    payload.deviceName || "",
    payload.appVersion || "0.4.4"
  ]);

  sh.autoResizeColumns(1, 6);
}
// v0.7 - Módulo 10/11: uma linha por computador/vendedor que já sincronizou, sempre
// atualizada (nunca duplica linha para o mesmo deviceId) - dá visão de quantas caixas
// estão ativas e quando cada uma sincronizou pela última vez.
function updateDispositivos(ss, payload) {
  var sh = getSheet(ss, "Dispositivos");

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 4)
      .setValues([["ID do dispositivo", "Nome do computador", "Última sincronização", "Qtd. vendas enviadas"]])
      .setFontWeight("bold")
      .setBackground(COLORS.section);
  }

  var deviceId = payload.deviceId || "";
  if (!deviceId) return;

  var data = sh.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === deviceId) { rowIndex = i + 1; break; }
  }

  var rowValues = [deviceId, payload.deviceName || "", new Date(), payload.sales ? payload.sales.length : 0];
  if (rowIndex === -1) {
    sh.appendRow(rowValues);
  } else {
    sh.getRange(rowIndex, 1, 1, 4).setValues([rowValues]);
  }
  sh.autoResizeColumns(1, 4);
}
