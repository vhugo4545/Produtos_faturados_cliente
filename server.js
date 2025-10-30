/**
 * Servidor Express + MongoDB (Mongoose)
 * - Um único arquivo
 * - Endpoints CRUD para "Aba de produtos faturados direto"
 * - Criação individual e em lote
 * - Filtros, busca livre (?q=) e paginação
 *
 * Variáveis de ambiente (.env):
 *   MONGO_URI, PORT, OMIE_APP_KEY, OMIE_APP_SECRET, JWT_SECRET, JWT_REFRESH
 */

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");

// ====== carrega .env ======
dotenv.config();

// ====== FALLBACKS (use .env em produção) ======
const {
  MONGO_URI = "mongodb+srv://USUARIO:SENHA@HOST/DB?retryWrites=true&w=majority",
  PORT = 3000,
  OMIE_APP_KEY = "CHANGEME",
  OMIE_APP_SECRET = "CHANGEME",
  JWT_SECRET = "CHANGEME",
  JWT_REFRESH = "CHANGEME",
} = process.env;

// ====== Conexão Mongo ======
mongoose.set("strictQuery", true);
mongoose
  .connect(MONGO_URI, { dbName: "proposta-db" })
  .then(() => console.log("✅ MongoDB conectado"))
  .catch((err) => {
    console.error("❌ Erro ao conectar no MongoDB:", err.message);
    process.exit(1);
  });

// ====== Schema ======
const PedidoVidroSchema = new mongoose.Schema(
  {
    // Cabeçalhos originais → campos camelCase
    numeroPedido: { type: String, trim: true },          // "Nº Pedido"
    cliente: { type: String, trim: true },                // "Cliente"
    fornecedor: { type: String, trim: true },             // "Fornecedor"
    vidro: { type: String, trim: true },                  // "Vidro"
    tipo: { type: String, trim: true },                   // "Tipo"
    quantidade: { type: Number, default: 0, min: 0 },    // "Quantidade"

    orcamentoEnviado: { type: String, trim: true },      // "Orçamento enviado"
    aprovacao: { type: String, trim: true },             // "Aprovação"
    moldeEnviado: { type: String, trim: true },          // "Molde enviado"
    recebemosLinkPagamento: { type: String, trim: true },// "Recebemos Link de pag."
    pagamento: { type: String, trim: true },             // "Pagamento"

    // Pedido: armazenar como Data (aceita string DD/MM/AAAA na normalização)
    previsao: { type: Date },                             // "Previsão" (data)

    numeroPedidoFornecedor: { type: String, trim: true },// "Nº  Pedido      Fornecedor"
    vidrosProntos: { type: String, trim: true },         // "Vidros prontos"
    naEmpresa: { type: String, trim: true },             // "Na empresa"
    faturamento: { type: String, trim: true },           // "Faturamento"

    responsavelVendedor: { type: String, trim: true },   // "Responsavel / Vendedor"
    numeroOrcFornecedor: { type: String, trim: true },   // "Nº Orç. Fornecedor"
    valorReal: { type: Number, default: 0 },             // "Valor Real"
    numeroNotaFiscal: { type: String, trim: true },      // "Nº Nota Fiscal"
    formaPagamento: { type: String, trim: true },        // "Forma de pag."
    observacao: { type: String, trim: true },            // "Observação"

    // Campo livre para extensões futuras
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

// Índices úteis (buscas e filtros frequentes)
PedidoVidroSchema.index({ numeroPedido: 1 });
PedidoVidroSchema.index({ cliente: 1 });
PedidoVidroSchema.index({ fornecedor: 1 });
PedidoVidroSchema.index({ previsao: 1 });
PedidoVidroSchema.index({ numeroNotaFiscal: 1 });

// Índice de texto opcional para buscas gerais (q)
PedidoVidroSchema.index({
  numeroPedido: "text",
  cliente: "text",
  fornecedor: "text",
  responsavelVendedor: "text",
  vidro: "text",
  tipo: "text",
  observacao: "text",
});

const PedidoVidro = mongoose.model("PedidoVidro", PedidoVidroSchema);

// ====== App ======
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ====== Utils ======

/** Sanitiza chave: remove múltiplos espaços e quebras de linha */
const cleanKey = (s) =>
  String(s || "")
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, " / ")
    .trim();

/** Converte número em BR ("R$ 1.234,56") para float */
function toNumberBR(v) {
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).replace(/[^\d.,-]/g, "");
  if (s.includes(",") && s.includes(".")) return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  if (s.includes(",")) return parseFloat(s.replace(",", ".")) || 0;
  const f = parseFloat(s);
  return Number.isNaN(f) ? 0 : f;
}

/** Tenta parsear datas: aceita Date, ISO, "DD/MM/AAAA" */
function parseDateFlexible(v) {
  if (!v) return undefined;
  if (v instanceof Date && !isNaN(v)) return v;
  const s = String(v).trim();
  // DD/MM/AAAA
  const dm = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dm) {
    const d = parseInt(dm[1], 10);
    const m = parseInt(dm[2], 10) - 1;
    const y = parseInt(dm[3], 10) < 100 ? 2000 + parseInt(dm[3], 10) : parseInt(dm[3], 10);
    const dt = new Date(Date.UTC(y, m, d, 12, 0, 0)); // meio-dia UTC para evitar fuso mudar o dia
    return isNaN(dt) ? undefined : dt;
  }
  // ISO/Outros
  const dt = new Date(s);
  return isNaN(dt) ? undefined : dt;
}

/**
 * Normaliza um item vindo do front (células da tabela) para o schema.
 * Aceita cabeçalhos "bagunçados" (quebras de linha, espaços múltiplos).
 */
function normalizeItem(raw = {}) {
  // Mapeia chaves limpas -> valor
  const normalized = {};
  for (const [k, v] of Object.entries(raw)) {
    normalized[cleanKey(k)] = v;
  }

  const pick = (...keys) => {
    for (const k of keys) {
      if (raw[k] !== undefined) return raw[k];
      if (normalized[cleanKey(k)] !== undefined) return normalized[cleanKey(k)];
    }
    return undefined;
  };

  const numeroPedido = pick("numeroPedido", "Nº Pedido", "nPedido", "pedido", "numero_pedido");
  const cliente = pick("cliente", "Cliente", "nomeCliente");
  const fornecedor = pick("fornecedor", "Fornecedor");
  const vidro = pick("vidro", "Vidro");
  const tipo = pick("tipo", "Tipo");

  const quantidadeRaw = pick("quantidade", "Quantidade");
  const quantidade =
    typeof quantidadeRaw === "number"
      ? quantidadeRaw
      : toNumberBR(quantidadeRaw);

  const orcamentoEnviado = pick("orcamentoEnviado", "Orçamento enviado", "Orçamento\nenviado", "Orçamento enviado");
  const aprovacao = pick("aprovacao", "Aprovação");
  const moldeEnviado = pick("moldeEnviado", "Molde enviado");
  const recebemosLinkPagamento = pick("recebemosLinkPagamento", "Recebemos Link de pag.", "Recebemos Link de pag");
  const pagamento = pick("pagamento", "Pagamento");

  const previsaoRaw = pick("previsao", "Previsão");
  const previsao = parseDateFlexible(previsaoRaw);

  const numeroPedidoFornecedor = pick(
    "numeroPedidoFornecedor",
    "Nº  Pedido      Fornecedor",
    "Nº Pedido Fornecedor",
    "nPedidoFornecedor"
  );

  const vidrosProntos = pick("vidrosProntos", "Vidros prontos");
  const naEmpresa = pick("naEmpresa", "Na empresa");
  const faturamento = pick("faturamento", "Faturamento");

  const responsavelVendedor = pick(
    "responsavelVendedor",
    "Responsavel / Vendedor",
    "Responsável / Vendedor",
    "Responsavel\n/ Vendedor",
    "Responsável\n/ Vendedor"
  );

  const numeroOrcFornecedor = pick("numeroOrcFornecedor", "Nº Orç. Fornecedor", "numeroOrcFornecedor");
  const valorRealRaw = pick("valorReal", "Valor Real");
  const valorReal = typeof valorRealRaw === "number" ? valorRealRaw : toNumberBR(valorRealRaw);

  const numeroNotaFiscal = pick("numeroNotaFiscal", "Nº Nota Fiscal", "notaFiscal");
  const formaPagamento = pick("formaPagamento", "Forma de pag.", "Forma de pag");
  const observacao = pick("observacao", "Observação");

  const meta = pick("meta");

  return {
    numeroPedido,
    cliente,
    fornecedor,
    vidro,
    tipo,
    quantidade,
    orcamentoEnviado,
    aprovacao,
    moldeEnviado,
    recebemosLinkPagamento,
    pagamento,
    previsao, // Date
    numeroPedidoFornecedor,
    vidrosProntos,
    naEmpresa,
    faturamento,
    responsavelVendedor,
    numeroOrcFornecedor,
    valorReal,
    numeroNotaFiscal,
    formaPagamento,
    observacao,
    meta,
  };
}

/** Monta paginação padrão */
function buildPagination(req) {
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10), 1), 500);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

/** Constrói filtros + busca livre (?q=) */
function buildFilters(query) {
  const f = {};
  if (query.cliente) f.cliente = new RegExp(query.cliente, "i");
  if (query.fornecedor) f.fornecedor = new RegExp(query.fornecedor, "i");
  if (query.numeroPedido) f.numeroPedido = new RegExp(query.numeroPedido, "i");
  if (query.responsavelVendedor) f.responsavelVendedor = new RegExp(query.responsavelVendedor, "i");
  if (query.statusFaturamento) f.faturamento = new RegExp(query.statusFaturamento, "i");
  if (query.numeroNotaFiscal) f.numeroNotaFiscal = new RegExp(query.numeroNotaFiscal, "i");

  // Busca livre (?q=) em campos chave
  if (query.q) {
    const q = String(query.q).trim();
    f.$or = [
      { numeroPedido: new RegExp(q, "i") },
      { cliente: new RegExp(q, "i") },
      { fornecedor: new RegExp(q, "i") },
    ];
  }

  // Filtro por intervalo de previsao (data), se vierem datas válidas
  if (query.previsaoStart || query.previsaoEnd) {
    const d = {};
    const s = parseDateFlexible(query.previsaoStart);
    const e = parseDateFlexible(query.previsaoEnd);
    if (s) d.$gte = s;
    if (e) d.$lte = e;
    if (Object.keys(d).length) f.previsao = d;
  }

  return f;
}

// ====== Rotas ======

app.get("/", async (req, res) => {
  res.json({
    ok: true,
    msg: "API de Produtos Faturados Direto (Mongo) está ativa.",
    mongo: mongoose.connection.readyState === 1 ? "connected" : "not-connected",
    campos: [
      "numeroPedido", "cliente", "fornecedor", "vidro", "tipo", "quantidade",
      "orcamentoEnviado", "aprovacao", "moldeEnviado", "recebemosLinkPagamento",
      "pagamento", "previsao", "numeroPedidoFornecedor", "vidrosProntos",
      "naEmpresa", "faturamento", "responsavelVendedor", "numeroOrcFornecedor",
      "valorReal", "numeroNotaFiscal", "formaPagamento", "observacao", "meta"
    ],
  });
});

/** Criar item único */
app.post("/api/produtos", async (req, res) => {
  try {
    const data = normalizeItem(req.body || {});
    const created = await PedidoVidro.create(data);
    res.status(201).json({ ok: true, data: created });
  } catch (err) {
    console.error("POST /api/produtos error:", err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

/** Criar em lote: { items: [ {...}, {...} ] } */
app.post("/api/produtos/bulk", async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ ok: false, error: "items vazio" });

    const docs = items.map(normalizeItem);
    const created = await PedidoVidro.insertMany(docs, { ordered: false });
    res.status(201).json({ ok: true, inserted: created.length, data: created });
  } catch (err) {
    console.error("POST /api/produtos/bulk error:", err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

/**
 * Listar (com filtros, busca livre e paginação)
 * Query: page, limit, cliente, fornecedor, numeroPedido, responsavelVendedor, statusFaturamento, numeroNotaFiscal, q, previsaoStart, previsaoEnd
 */
app.get("/api/produtos", async (req, res) => {
  try {
    const { page, limit, skip } = buildPagination(req);
    const filters = buildFilters(req.query);

    const [data, total] = await Promise.all([
      PedidoVidro.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit),
      PedidoVidro.countDocuments(filters),
    ]);

    res.json({
      ok: true,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      data,
    });
  } catch (err) {
    console.error("GET /api/produtos error:", err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

/** Buscar por ID */
app.get("/api/produtos/:id", async (req, res) => {
  try {
    const doc = await PedidoVidro.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, error: "não encontrado" });
    res.json({ ok: true, data: doc });
  } catch (err) {
    console.error("GET /api/produtos/:id error:", err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

/** Atualizar por ID */
app.put("/api/produtos/:id", async (req, res) => {
  try {
    const payload = normalizeItem(req.body || {});
    const updated = await PedidoVidro.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });
    if (!updated) return res.status(404).json({ ok: false, error: "não encontrado" });
    res.json({ ok: true, data: updated });
  } catch (err) {
    console.error("PUT /api/produtos/:id error:", err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

/** Remover por ID */
app.delete("/api/produtos/:id", async (req, res) => {
  try {
    const removed = await PedidoVidro.findByIdAndDelete(req.params.id);
    if (!removed) return res.status(404).json({ ok: false, error: "não encontrado" });
    res.json({ ok: true, data: removed });
  } catch (err) {
    console.error("DELETE /api/produtos/:id error:", err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

/** Remover em lote por IDs: { ids: ["...", "..."] } */
app.post("/api/produtos/delete-bulk", async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ ok: false, error: "ids vazio" });

    const result = await PedidoVidro.deleteMany({ _id: { $in: ids } });
    res.json({ ok: true, deletedCount: result.deletedCount });
  } catch (err) {
    console.error("POST /api/produtos/delete-bulk error:", err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ====== Start ======
app.listen(PORT, () => {
  console.log(`🚀 Server rodando em http://localhost:${PORT}`);
  console.log(`🔗 Mongo: ${MONGO_URI ? "(definido)" : "(vazio)"}`);
  console.log(
    `🔐 OMIE_APP_KEY: ${OMIE_APP_KEY ? "(definida)" : "(vazia)"} | OMIE_APP_SECRET: ${OMIE_APP_SECRET ? "(definida)" : "(vazia)"}`
  );
});
