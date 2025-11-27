// server.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");

// ====== .env ======
dotenv.config();

// ====== FALLBACKS (use .env em produção) ======
const {
  // use .env em produção; fallback local para desenvolvimento
  MONGO_URI = "mongodb://127.0.0.1:27017/proposta-db",
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

// ====== fetch (para Omie) ======
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

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
  if (v instanceof Date && !isNaNaN(v)) return v;
  const s = String(v).trim();
  const dm = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dm) {
    const d = parseInt(dm[1], 10);
    const m = parseInt(dm[2], 10) - 1;
    const yRaw = parseInt(dm[3], 10);
    const y = yRaw < 100 ? 2000 + yRaw : yRaw;
    const dt = new Date(Date.UTC(y, m, d, 12, 0, 0));
    return isNaN(dt) ? undefined : dt;
  }
  const dt = new Date(s);
  return isNaN(dt) ? undefined : dt;
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

  doc.valorAproximadoUF = Number((pedido - fatDir).toFixed(2));
  doc.residuoDiferencaFaturamentoServico = Number(
    (fatDir + nfServ - real).toFixed(2)
  );
}

/* ===============
   Schema/Modelo
   =============== */
const PedidoVidroSchema = new mongoose.Schema(
  {
    numeroPedido: { type: String, trim: true, default: "" },
    cliente: { type: String, trim: true, default: "" },

    // 🔹 sempre presente em cada linha
    fornecedor: {
      type: String,
      trim: true,
      default: "",
      required: false,
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

    meta: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

PedidoVidroSchema.pre("save", function (next) {
  computeDerived(this);
  next();
});

PedidoVidroSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate() || {};
  const target = update.$set ? update.$set : update;
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
      }
      next();
    })
    .catch(next);
});

const PedidoVidro = mongoose.model("PedidoVidro", PedidoVidroSchema);

/* =======================
   Normalização de payload
   ======================= */

/**
 * Garante que todo produto tenha:
 * - fornecedor
 * - numeroNotaFiscal
 * - formaPagamento
 * - observacao
 * + normaliza strings / números / datas
 */
function normalizeProdutoPayload(body = {}) {
  const payload = { ...body };

  payload.numeroPedido = cleanKey(payload.numeroPedido || "");
  payload.cliente = cleanKey(payload.cliente || "");
  payload.fornecedor = cleanKey(payload.fornecedor || "");
  payload.vidro = cleanKey(payload.vidro || "");
  payload.tipo = cleanKey(payload.tipo || "");
  payload.responsavelVendedor = cleanKey(payload.responsavelVendedor || "");
  payload.numeroPedidoFornecedor = cleanKey(payload.numeroPedidoFornecedor || "");
  payload.numeroOrcFornecedor = cleanKey(payload.numeroOrcFornecedor || "");

  payload.numeroNotaFiscal = cleanKey(payload.numeroNotaFiscal || "");
  payload.formaPagamento = cleanKey(payload.formaPagamento || "");
  payload.observacao = String(payload.observacao || "").trim();

  // números
  payload.quantidade = Number(payload.quantidade || 0);
  payload.valorTotalPedido = Number(payload.valorTotalPedido || 0);
  payload.valorTotalFaturamentoDiretoOrcado = Number(
    payload.valorTotalFaturamentoDiretoOrcado || 0
  );
  payload.valorTotalNFProdutos = Number(payload.valorTotalNFProdutos || 0);
  payload.valorTotalNFServicos = Number(payload.valorTotalNFServicos || 0);
  payload.valorReal = Number(payload.valorReal || 0);

  // datas flexíveis
  if (payload.previsao) payload.previsao = parseDateFlexible(payload.previsao);
  if (payload.vidrosProntos)
    payload.vidrosProntos = parseDateFlexible(payload.vidrosProntos);
  if (payload.naEmpresa) payload.naEmpresa = parseDateFlexible(payload.naEmpresa);

  return payload;
}

/* =======================
   App & Middlewares
   ======================= */
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

/* =======================
   Rotas CRUD Mongo
   ======================= */

// Healthcheck / raiz
app.get("/", (req, res) =>
  res.json({ ok: true, msg: "API de Produtos Faturados Direto ativa." })
);

// Criar produto
app.post("/api/produtos", async (req, res) => {
  try {
    const payload = normalizeProdutoPayload(req.body);
    const created = await PedidoVidro.create(payload);
    res.status(201).json({ ok: true, data: created });
  } catch (err) {
    console.error("❌ Erro ao criar produto:", err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Listar produtos
app.get("/api/produtos", async (req, res) => {
  try {
    const data = await PedidoVidro.find().sort({ createdAt: -1 });
    res.json({ ok: true, data });
  } catch (err) {
    console.error("❌ Erro ao listar produtos:", err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Atualizar produto
app.put("/api/produtos/:id", async (req, res) => {
  try {
    const payload = normalizeProdutoPayload(req.body);
    const updated = await PedidoVidro.findByIdAndUpdate(
      req.params.id,
      payload,
      { new: true, runValidators: true }
    );
    if (!updated) {
      return res.status(404).json({ ok: false, error: "não encontrado" });
    }
    res.json({ ok: true, data: updated });
  } catch (err) {
    console.error("❌ Erro ao atualizar produto:", err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Remover produto
app.delete("/api/produtos/:id", async (req, res) => {
  try {
    const removed = await PedidoVidro.findByIdAndDelete(req.params.id);
    if (!removed) {
      return res.status(404).json({ ok: false, error: "não encontrado" });
    }
    res.json({ ok: true, data: removed });
  } catch (err) {
    console.error("❌ Erro ao remover produto:", err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});

/* =======================
   🔹 Nova rota Omie - Comissão
   ======================= */
const OMIE_URL = "https://app.omie.com.br/api/v1/financas/contapagar/";

app.post("/api/omie/comissao", async (req, res) => {
  try {
    console.log("📥 [COMISSAO] Requisição recebida em /api/omie/comissao");

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

    // Log de entrada (parcial pra não poluir)
    console.log("🔎 [COMISSAO] Body recebido (resumo):", {
      valor_documento,
      data_vencimento,
      data_previsao,
      codigo_cliente_fornecedor,
      catFromBody,
      tipo,
      papel,
      tipo_comissao,
      observacao_preview: observacao?.slice(0, 80) || null,
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
          obs_preview: obs.slice(0, 80),
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

    console.log("📦 [COMISSAO] Payload preparado para Omie (resumo):", {
      codigo_cliente_fornecedor,
      codigo_categoria,
      id_conta_corrente,
      valor_documento: Number(valor_documento),
      data_vencimento: toBRDate(data_vencimento),
      data_previsao: toBRDate(data_previsao),
      observacao_preview: (
        observacao ?? "Lançamento de comissão via API"
      ).slice(0, 80),
    });

    const r = await fetch(OMIE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const omie = await r.json();

    if (!r.ok) {
      console.error("❌ [COMISSAO] Erro na resposta da Omie:", {
        status: r.status,
        statusText: r.statusText,
        resposta: omie,
      });
    } else {
      console.log("📤 [COMISSAO] Comissão enviada com sucesso para Omie:", {
        status: r.status,
        resposta_resumo: {
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
  console.log(`🔗 Mongo: ${MONGO_URI ? "(definido)" : "(vazio)"}`);
  console.log(
    `🔐 OMIE_APP_KEY: ${
      OMIE_APP_KEY ? "(definida)" : "(vazia)"
    } | OMIE_APP_SECRET: ${OMIE_APP_SECRET ? "(definida)" : "(vazia)"}`
  );
});
