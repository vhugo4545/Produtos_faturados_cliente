// server.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");

// ====== .env ======
dotenv.config();

// ====== FALLBACKS (use .env em produção) ======
const {
  MONGO_URI = "mongodb://127.0.0.1:27017/proposta-db",
  PORT = 3000,
  OMIE_APP_KEY = "CHANGEME",
  OMIE_APP_SECRET = "CHANGEME",
  JWT_SECRET = "CHANGEME",
  JWT_REFRESH = "CHANGEME",
} = process.env;

// ====== Conexão Mongo ======
console.log("🔌 Iniciando conexão com MongoDB...");
mongoose.set("strictQuery", true);
mongoose
  .connect(MONGO_URI, { dbName: "proposta-db" })
  .then(() => {
    console.log("✅ MongoDB conectado com sucesso");
  })
  .catch((err) => {
    console.error("❌ Erro ao conectar no MongoDB:", err.message);
    console.error(err);
    process.exit(1);
  });

// ====== fetch (para Omie) ======
const fetch = (...args) =>
  import("node-fetch").then(({ default: f }) => f(...args));

/* =======================
   Helpers de normalização
   ======================= */

/** Remove múltiplos espaços/linhas e normaliza barras */
const cleanKey = (s) =>
  String(s || "")
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, " / ")
    .trim();

/** Converte BR ("R$ 1.234,56") → Number */
function toNumberBR(v) {
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).replace(/[^\d.,-]/g, "");
  if (s.includes(",") && s.includes(".")) {
    return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  }
  if (s.includes(",")) {
    return parseFloat(s.replace(",", ".")) || 0;
  }
  const f = parseFloat(s);
  return Number.isNaN(f) ? 0 : f;
}

/** Tenta parsear datas: aceita Date, ISO, "DD/MM/AAAA" */
function parseDateFlexible(v) {
  if (!v) return undefined;
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  const s = String(v).trim();
  const dm = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dm) {
    const d = parseInt(dm[1], 10);
    const m = parseInt(dm[2], 10) - 1;
    const yRaw = parseInt(dm[3], 10);
    const y = yRaw < 100 ? 2000 + yRaw : yRaw;
    const dt = new Date(Date.UTC(y, m, d, 12, 0, 0));
    return isNaN(dt.getTime()) ? undefined : dt;
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? undefined : dt;
}

/** Converte Date/string → "DD/MM/AAAA" (Omie aceita esse formato) */
function toBRDate(input) {
  if (typeof input === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(input.trim())) {
    return input.trim();
  }
  const d = parseDateFlexible(input);
  if (!d) return String(input || "");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Cálculo dos campos derivados */
function computeDerived(doc) {
  const pedido = Number(doc.valorTotalPedido) || 0;
  const fatDir = Number(doc.valorTotalFaturamentoDiretoOrcado) || 0;
  const nfServ = Number(doc.valorTotalNFServicos) || 0;
  const real = Number(doc.valorReal) || 0;

  const valorAproximadoUF = Number((pedido - fatDir).toFixed(2));
  const residuo = Number((fatDir + nfServ - real).toFixed(2));

  doc.valorAproximadoUF = valorAproximadoUF;
  doc.residuoDiferencaFaturamentoServico = residuo;

  console.log("🧮 computeDerived:", {
    valorTotalPedido: pedido,
    valorTotalFaturamentoDiretoOrcado: fatDir,
    valorTotalNFServicos: nfServ,
    valorReal: real,
    valorAproximadoUF,
    residuoDiferencaFaturamentoServico: residuo,
  });
}

/* ===============
   Schema/Modelo
   =============== */
const PedidoVidroSchema = new mongoose.Schema(
  {
    numeroPedido: { type: String, trim: true, default: "" },

    // 🔹 NOVO CAMPO – número de orçamento
    // se não vier do front, é preenchido a partir de numeroPedido na normalização
    numeroOrcamento: { type: String, trim: true, default: "" },

    cliente: { type: String, trim: true, default: "" },

    // 🔹 sempre presente em cada linha
    fornecedor: {
      type: String,
      trim: true,
      default: "",
      required: false,
    },

    // 🔹 informação de agrupamento (grupo na tela)
    grupoNome: {
      type: String,
      trim: true,
      default: "",
    },
    grupoTipo: {
      type: String,
      trim: true,
      default: "",
    },

    // 🔹 Produto acabado ao qual este insumo pertence
    produtoAcabadoCodigo: {
      type: String,
      trim: true,
      default: "",
    },
    produtoAcabadoDescricao: {
      type: String,
      trim: true,
      default: "",
    },
    produtoAcabadoGrupoId: {
      type: String,
      trim: true,
      default: "",
    },
    produtoAcabadoAmbiente: {
      type: String,
      trim: true,
      default: "",
    },

    vidro: { type: String, trim: true, default: "" },
    tipo: { type: String, trim: true, default: "" },
    quantidade: { type: Number, default: 0 },

    orcamentoEnviado: { type: String, trim: true, default: "" },
    aprovacao: { type: String, trim: true, default: "" },
    moldeEnviado: { type: String, trim: true, default: "" },
    recebemosLinkPagamento: { type: String, trim: true, default: "" },
    pagamento: { type: String, trim: true, default: "" },

    previsao: Date,
    numeroPedidoFornecedor: { type: String, trim: true, default: "" },
    vidrosProntos: Date,
    naEmpresa: Date,
    faturamento: { type: String, trim: true, default: "" },
    responsavelVendedor: { type: String, trim: true, default: "" },
    numeroOrcFornecedor: { type: String, trim: true, default: "" },

    valorTotalPedido: { type: Number, default: 0 },
    valorTotalFaturamentoDiretoOrcado: { type: Number, default: 0 },
    valorAproximadoUF: { type: Number, default: 0 },
    valorTotalNFProdutos: { type: Number, default: 0 },
    valorTotalNFServicos: { type: Number, default: 0 },
    valorReal: { type: Number, default: 0 },
    residuoDiferencaFaturamentoServico: { type: Number, default: 0 },

    // 🔹 NF por linha de insumo
    numeroNotaFiscal: {
      type: String,
      trim: true,
      default: "",
      required: false,
    },

    // 🔹 forma de pagamento por linha
    formaPagamento: {
      type: String,
      trim: true,
      default: "",
      required: false,
    },

    // 🔹 observação por linha
    observacao: {
      type: String,
      trim: true,
      default: "",
    },

    // 🔹 Qualquer estrutura auxiliar (totais do popup, telefone fornecedor, etc.)
    meta: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

PedidoVidroSchema.pre("save", function (next) {
  console.log("🟡 [MONGO] pre-save chamado para documento:", {
    _id: this._id,
    numeroPedido: this.numeroPedido,
    numeroOrcamento: this.numeroOrcamento,
    cliente: this.cliente,
    vidro: this.vidro,
  });
  computeDerived(this);
  next();
});

PedidoVidroSchema.pre("findOneAndUpdate", function (next) {
  console.log("🟠 [MONGO] pre-findOneAndUpdate query:", this.getQuery());
  const update = this.getUpdate() || {};
  const target = update.$set ? update.$set : update;

  console.log("🟠 [MONGO] pre-findOneAndUpdate update original:", update);

  this.model
    .findOne(this.getQuery())
    .then((doc) => {
      if (doc) {
        const merged = { ...doc.toObject(), ...target };
        computeDerived(merged);
        if (update.$set) {
          update.$set.valorAproximadoUF = merged.valorAproximadoUF;
          update.$set.residuoDiferencaFaturamentoServico =
            merged.residuoDiferencaFaturamentoServico;
        } else {
          update.valorAproximadoUF = merged.valorAproximadoUF;
          update.residuoDiferencaFaturamentoServico =
            merged.residuoDiferencaFaturamentoServico;
        }
        this.setUpdate(update);
        console.log("🟠 [MONGO] pre-findOneAndUpdate update final:", update);
      } else {
        console.log("🔍 [MONGO] pre-findOneAndUpdate: nenhum doc encontrado.");
      }
      next();
    })
    .catch((err) => {
      console.error("❌ [MONGO] Erro no pre-findOneAndUpdate:", err);
      next(err);
    });
});

const PedidoVidro = mongoose.model("PedidoVidro", PedidoVidroSchema);

/* =======================
   Normalização de payload
   ======================= */

/**
 * Garante que todo produto tenha:
 * - numeroOrcamento sempre preenchido
 *   (se não vier, copia de numeroPedido)
 * - fornecedor / grupoNome / grupoTipo
 * - numeroNotaFiscal / formaPagamento / observacao
 * + normaliza strings / números / datas
 * + preserva meta (Mixed) como vier
 */
function normalizeProdutoPayload(body = {}) {
  console.log("🧾 [NORMALIZE] Body bruto recebido:", body);

  const payload = { ...body };

  // numeroPedido primeiro
  payload.numeroPedido = cleanKey(payload.numeroPedido || "");

  // numeroOrcamento:
  // se vier do front usa, se vier vazio/null usa numeroPedido.
  payload.numeroOrcamento = cleanKey(
    payload.numeroOrcamento || payload.numeroPedido || ""
  );

  payload.cliente = cleanKey(payload.cliente || "");
  payload.fornecedor = cleanKey(payload.fornecedor || "");
  payload.vidro = cleanKey(payload.vidro || "");
  payload.tipo = cleanKey(payload.tipo || "");
  payload.responsavelVendedor = cleanKey(payload.responsavelVendedor || "");
  payload.numeroPedidoFornecedor = cleanKey(
    payload.numeroPedidoFornecedor || ""
  );
  payload.numeroOrcFornecedor = cleanKey(payload.numeroOrcFornecedor || "");

  // 🔹 grupo (pra agrupar na tela)
  payload.grupoNome = cleanKey(payload.grupoNome || "");
  payload.grupoTipo = cleanKey(payload.grupoTipo || "");

  // 🔹 produto acabado (pai do insumo)
  payload.produtoAcabadoCodigo = cleanKey(
    payload.produtoAcabadoCodigo || ""
  );
  payload.produtoAcabadoDescricao = cleanKey(
    payload.produtoAcabadoDescricao || ""
  );
  payload.produtoAcabadoGrupoId = cleanKey(
    payload.produtoAcabadoGrupoId || ""
  );
  payload.produtoAcabadoAmbiente = cleanKey(
    payload.produtoAcabadoAmbiente || ""
  );

  payload.numeroNotaFiscal = cleanKey(payload.numeroNotaFiscal || "");
  payload.formaPagamento = cleanKey(payload.formaPagamento || "");
  payload.observacao = String(payload.observacao || "").trim();

  // números – aceita Number ou string (se vier formatado tipo "R$ 1.234,56")
  payload.quantidade = toNumberBR(payload.quantidade);
  payload.valorTotalPedido = toNumberBR(payload.valorTotalPedido);
  payload.valorTotalFaturamentoDiretoOrcado = toNumberBR(
    payload.valorTotalFaturamentoDiretoOrcado
  );
  payload.valorTotalNFProdutos = toNumberBR(payload.valorTotalNFProdutos);
  payload.valorTotalNFServicos = toNumberBR(payload.valorTotalNFServicos);
  payload.valorReal = toNumberBR(payload.valorReal);

  // datas flexíveis
  if (payload.previsao) payload.previsao = parseDateFlexible(payload.previsao);
  if (payload.vidrosProntos)
    payload.vidrosProntos = parseDateFlexible(payload.vidrosProntos);
  if (payload.naEmpresa)
    payload.naEmpresa = parseDateFlexible(payload.naEmpresa);

  // meta é Mixed → deixamos como veio (pode ter totaisSelecaoOmie, telefone fornecedor, etc.)
  if (payload.meta && typeof payload.meta === "object") {
    payload.meta = { ...payload.meta };
  }

  console.log("✅ [NORMALIZE] Payload normalizado:", payload);
  return payload;
}

/* =======================
   App & Middlewares
   ======================= */
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Middleware simples de log de requisições
app.use((req, res, next) => {
  console.log(
    `➡️  ${req.method} ${req.originalUrl} | IP: ${req.ip} | Time: ${new Date().toISOString()}`
  );
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    console.log("📨 Body recebido:", req.body);
  }
  next();
});

/* =======================
   Rotas CRUD Mongo
   ======================= */

// Healthcheck / raiz
app.get("/", (req, res) => {
  console.log("📡 [GET /] Healthcheck chamado");
  res.json({ ok: true, msg: "API de Produtos Faturados Direto ativa." });
});

// Criar produto
app.post("/api/produtos", async (req, res) => {
  console.log("📥 [POST /api/produtos] Início da rota");
  try {
    const payload = normalizeProdutoPayload(req.body);
    console.log("🧩 [POST /api/produtos] Payload final para create:", payload);

    const created = await PedidoVidro.create(payload);

    console.log("✅ [POST /api/produtos] Produto criado:", {
      _id: created._id,
      numeroPedido: created.numeroPedido,
      numeroOrcamento: created.numeroOrcamento,
      cliente: created.cliente,
      vidro: created.vidro,
      grupoNome: created.grupoNome,
      grupoTipo: created.grupoTipo,
      valorReal: created.valorReal,
    });

    res.status(201).json({ ok: true, data: created });
  } catch (err) {
    console.error("❌ [POST /api/produtos] Erro ao criar produto:", err.message);
    console.error(err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Listar produtos
app.get("/api/produtos", async (req, res) => {
  console.log("📥 [GET /api/produtos] Início da rota");
  console.log("🔎 Query params recebidos:", req.query);

  try {
    const filter = {};
    if (req.query.numeroPedido) {
      filter.numeroPedido = String(req.query.numeroPedido);
    }
    if (req.query.numeroOrcamento) {
      filter.numeroOrcamento = String(req.query.numeroOrcamento);
    }

    console.log("🔍 [GET /api/produtos] Filtro Mongo:", filter);

    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    let q = PedidoVidro.find(filter).sort({ createdAt: -1 });
    if (limit && !Number.isNaN(limit)) {
      q = q.limit(limit);
    }

    const data = await q.exec();

    console.log("✅ [GET /api/produtos] Documentos encontrados:", data.length);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("❌ [GET /api/produtos] Erro ao listar produtos:", err.message);
    console.error(err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Atualizar produto
app.put("/api/produtos/:id", async (req, res) => {
  console.log("📥 [PUT /api/produtos/:id] Início da rota, id:", req.params.id);
  try {
    const payload = normalizeProdutoPayload(req.body);
    console.log(
      "🧩 [PUT /api/produtos/:id] Payload final para update:",
      payload
    );

    const updated = await PedidoVidro.findByIdAndUpdate(
      req.params.id,
      payload,
      { new: true, runValidators: true }
    );

    if (!updated) {
      console.warn(
        "⚠️ [PUT /api/produtos/:id] Produto não encontrado:",
        req.params.id
      );
      return res.status(404).json({ ok: false, error: "não encontrado" });
    }

    console.log("✅ [PUT /api/produtos/:id] Produto atualizado:", {
      _id: updated._id,
      numeroPedido: updated.numeroPedido,
      numeroOrcamento: updated.numeroOrcamento,
      cliente: updated.cliente,
      vidro: updated.vidro,
      grupoNome: updated.grupoNome,
      grupoTipo: updated.grupoTipo,
      valorReal: updated.valorReal,
    });

    res.json({ ok: true, data: updated });
  } catch (err) {
    console.error(
      "❌ [PUT /api/produtos/:id] Erro ao atualizar produto:",
      err.message
    );
    console.error(err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Remover produto
app.delete("/api/produtos/:id", async (req, res) => {
  console.log("📥 [DELETE /api/produtos/:id] Início da rota, id:", req.params.id);
  try {
    const removed = await PedidoVidro.findByIdAndDelete(req.params.id);

    if (!removed) {
      console.warn(
        "⚠️ [DELETE /api/produtos/:id] Produto não encontrado:",
        req.params.id
      );
      return res.status(404).json({ ok: false, error: "não encontrado" });
    }

    console.log("✅ [DELETE /api/produtos/:id] Produto removido:", {
      _id: removed._id,
      numeroPedido: removed.numeroPedido,
      numeroOrcamento: removed.numeroOrcamento,
      cliente: removed.cliente,
      vidro: removed.vidro,
      grupoNome: removed.grupoNome,
      grupoTipo: removed.grupoTipo,
      valorReal: removed.valorReal,
    });

    res.json({ ok: true, data: removed });
  } catch (err) {
    console.error(
      "❌ [DELETE /api/produtos/:id] Erro ao remover produto:",
      err.message
    );
    console.error(err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

/* =======================
   🔹 Nova rota Omie - Comissão
   ======================= */
const OMIE_URL = "https://app.omie.com.br/api/v1/financas/contapagar/";
// Contas a receber (resquício)
const OMIE_URL_RECEBER = "https://app.omie.com.br/api/v1/financas/contareceber/";

/* =======================
   🔹 Nova rota Omie - Resquício (Contas a Receber)
   ======================= */

app.post("/api/omie/resquicio", async (req, res) => {
  try {
    console.log("📥 [RESQUICIO] Requisição recebida em /api/omie/resquicio");
    console.log("📨 [RESQUICIO] Body completo recebido:", req.body);

    const {
      valor_documento,
      data_vencimento,
      data_previsao,
      codigo_cliente_fornecedor, // vem do front (obrigatório)
      id_conta_corrente = "4243124", // padrão para contas a receber (ajuste se usar outro)
      observacao, // opcional
    } = req.body || {};

    // Log de entrada (resumo)
    console.log("🔎 [RESQUICIO] Body recebido (resumo):", {
      valor_documento,
      data_vencimento,
      data_previsao,
      codigo_cliente_fornecedor,
      id_conta_corrente,
      observacao_preview: observacao?.slice(0, 120) || null,
    });

    // ================== validações ==================
    const erros = [];
    if (valor_documento == null) erros.push("valor_documento");
    if (!data_vencimento) erros.push("data_vencimento");
    if (!data_previsao) erros.push("data_previsao");
    if (!codigo_cliente_fornecedor) erros.push("codigo_cliente_fornecedor");

    if (erros.length) {
      console.warn(
        "⚠️ [RESQUICIO] Requisição inválida, campos ausentes:",
        erros
      );
      return res.status(400).json({
        ok: false,
        error: `Campos obrigatórios ausentes: ${erros.join(", ")}.`,
      });
    }

    // Categoria fixa para resquício (contas a receber)
    const codigo_categoria = "1.01.99";

    console.log("✅ [RESQUICIO] Categoria fixa utilizada:", codigo_categoria);

    // =============== payload Omie ===============
    const payload = {
      call: "IncluirContaReceber",
      app_key: OMIE_APP_KEY_SERVICOS,
      app_secret: OMIE_APP_SECRET_SERVICOS,
      param: [
        {
          codigo_lancamento_integracao: String(Date.now()),
          codigo_cliente_fornecedor, // do front
          codigo_categoria,          // FIXO: 1.01.99
          id_conta_corrente,
          valor_documento: Number(valor_documento),
          data_vencimento: toBRDate(data_vencimento),
          data_previsao: toBRDate(data_previsao),
          observacao: observacao ?? "Lançamento de resquício via API",
        },
      ],
    };

    console.log("📦 [RESQUICIO] Payload completo para Omie (contareceber):", payload);

    const r = await fetch(OMIE_URL_RECEBER, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const rawText = await r.text();
    console.log("📨 [RESQUICIO] Resposta bruta (texto) da Omie:", rawText);

    let omie;
    try {
      omie = JSON.parse(rawText);
    } catch (e) {
      console.warn(
        "⚠️ [RESQUICIO] Não foi possível parsear JSON da Omie, retornando texto bruto."
      );
      omie = { raw: rawText };
    }

    if (!r.ok) {
      console.error("❌ [RESQUICIO] Erro na resposta da Omie:", {
        status: r.status,
        statusText: r.statusText,
        resposta: omie,
      });
      return res.status(400).json({
        ok: false,
        error:
          omie?.faultstring ||
          omie?.descricaoStatus ||
          "Falha ao lançar resquício na Omie.",
        omie,
      });
    }

    console.log("📤 [RESQUICIO] Conta a receber (resquício) enviada com sucesso para Omie:", {
      status: r.status,
      resposta: omie,
      resumo: {
        codStatus: omie?.codStatus,
        descricaoStatus: omie?.descricaoStatus,
        faultstring: omie?.faultstring,
      },
    });

    res.json({ ok: true, omie });
  } catch (err) {
    console.error("💥 [RESQUICIO] Erro inesperado em POST /api/omie/resquicio:", {
      message: err?.message,
      stack: err?.stack,
    });
    res
      .status(500)
      .json({ ok: false, error: "Falha ao enviar resquício (conta a receber) para Omie." });
  }
});


app.post("/api/omie/comissao", async (req, res) => {
  try {
    console.log("📥 [COMISSAO] Requisição recebida em /api/omie/comissao");
    console.log("📨 [COMISSAO] Body completo recebido:", req.body);

    const {
      valor_documento,
      data_vencimento,
      data_previsao,
      codigo_cliente_fornecedor, // vem do front (obrigatório)
      codigo_categoria: catFromBody, // se vier do front, respeita
      id_conta_corrente = "2523861035",
      observacao, // vem do front (opcional, mas preferido)
      // dicas para inferir categoria quando não vier pronta:
      tipo,
      papel,
      tipo_comissao,
    } = req.body || {};

    // Log de entrada (resumo)
    console.log("🔎 [COMISSAO] Body recebido (resumo):", {
      valor_documento,
      data_vencimento,
      data_previsao,
      codigo_cliente_fornecedor,
      catFromBody,
      tipo,
      papel,
      tipo_comissao,
      observacao_preview: observacao?.slice(0, 120) || null,
    });

    // ================== validações ==================
    const erros = [];
    if (valor_documento == null) erros.push("valor_documento");
    if (!data_vencimento) erros.push("data_vencimento");
    if (!data_previsao) erros.push("data_previsao");
    if (!codigo_cliente_fornecedor) erros.push("codigo_cliente_fornecedor");

    if (erros.length) {
      console.warn(
        "⚠️ [COMISSAO] Requisição inválida, campos ausentes:",
        erros
      );
      return res.status(400).json({
        ok: false,
        error: `Campos obrigatórios ausentes: ${erros.join(", ")}.`,
      });
    }

    // =============== categoria dinâmica ===============
    let codigo_categoria = catFromBody; // prioridade ao que veio no body

    if (!codigo_categoria) {
      const hint = String(tipo || papel || tipo_comissao || "").toLowerCase();
      const obs = String(observacao || "").toLowerCase();

      console.log(
        "🧩 [COMISSAO] Inferindo categoria com base em hint/obs:",
        {
          hint,
          obs_preview: obs.slice(0, 120),
        }
      );

      if (hint.includes("arquit") || obs.includes("arquit")) {
        codigo_categoria = "2.08.02"; // arquiteto
      } else if (
        hint.includes("vend") ||
        obs.includes("vendedor") ||
        obs.includes("consultor")
      ) {
        codigo_categoria = "2.07.99"; // vendedor
      } else {
        // fallback padrão: vendedor
        codigo_categoria = "2.07.99";
      }
    }

    console.log("✅ [COMISSAO] Categoria final definida:", codigo_categoria);
    // =================================================

    const payload = {
      call: "IncluirContaPagar",
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [
        {
          codigo_lancamento_integracao: String(Date.now()),
          codigo_cliente_fornecedor, // do front
          codigo_categoria, // dinâmico
          id_conta_corrente,
          valor_documento: Number(valor_documento),
          data_vencimento: toBRDate(data_vencimento),
          data_previsao: toBRDate(data_previsao),
          observacao: observacao ?? "Lançamento de comissão via API",
        },
      ],
    };

    console.log("📦 [COMISSAO] Payload completo para Omie:", payload);

    const r = await fetch(OMIE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const rawText = await r.text();
    console.log("📨 [COMISSAO] Resposta bruta (texto) da Omie:", rawText);

    let omie;
    try {
      omie = JSON.parse(rawText);
    } catch (e) {
      console.warn(
        "⚠️ [COMISSAO] Não foi possível parsear JSON da Omie, retornando texto bruto."
      );
      omie = { raw: rawText };
    }

    if (!r.ok) {
      console.error("❌ [COMISSAO] Erro na resposta da Omie:", {
        status: r.status,
        statusText: r.statusText,
        resposta: omie,
      });
    } else {
      console.log("📤 [COMISSAO] Comissão enviada com sucesso para Omie:", {
        status: r.status,
        resposta: omie,
        resumo: {
          codStatus: omie?.codStatus,
          descricaoStatus: omie?.descricaoStatus,
          faultstring: omie?.faultstring,
        },
      });
    }

    res.json({ ok: true, omie });
  } catch (err) {
    console.error("💥 [COMISSAO] Erro inesperado em POST /api/omie/comissao:", {
      message: err?.message,
      stack: err?.stack,
    });
    res
      .status(500)
      .json({ ok: false, error: "Falha ao enviar comissão para Omie." });
  }
});

/* =======================
   Start
   ======================= */
app.listen(PORT, () => {
  console.log(`🚀 Server rodando em http://localhost:${PORT}`);
  console.log(`🔗 Mongo URI: ${MONGO_URI}`);
  console.log(
    `🔐 OMIE_APP_KEY: ${
      OMIE_APP_KEY ? "(definida)" : "(vazia)"
    } | OMIE_APP_SECRET: ${OMIE_APP_SECRET ? "(definida)" : "(vazia)"}`
  );
  console.log(`🔑 JWT_SECRET: ${JWT_SECRET ? "(definido)" : "(vazio)"}`);
  console.log(`🔑 JWT_REFRESH: ${JWT_REFRESH ? "(definido)" : "(vazio)"}`);
});
