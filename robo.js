const http = require("http");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");

const porta = Number(process.env.PORT) || 3000;
const linkPrincipal =
  process.env.INSTADELIVERY_MENU_URL || "https://instadelivery.com.br/fortindelivery";
const webhookPath = "/webhooks/instadelivery";
const defaultCountryCode = (process.env.DEFAULT_COUNTRY_CODE || "55").replace(/\D/g, "");
const webhookToken = process.env.INSTADELIVERY_WEBHOOK_TOKEN || "";
const allowedStoreId = process.env.INSTADELIVERY_STORE_ID
  ? Number(process.env.INSTADELIVERY_STORE_ID)
  : null;

function somenteDigitos(valor = "") {
  return String(valor).replace(/\D/g, "");
}

function carregarStatusLabels(valor) {
  if (!valor) {
    return {};
  }

  try {
    const parsed = JSON.parse(valor);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (erro) {
    console.log("Nao foi possivel ler INSTADELIVERY_STATUS_LABELS:", erro.message);
    return {};
  }
}

function numeroParaChatId(numero) {
  const digitos = somenteDigitos(numero);

  if (!digitos) {
    return null;
  }

  if (digitos.length >= 12) {
    return `${digitos}@c.us`;
  }

  if ((digitos.length === 10 || digitos.length === 11) && defaultCountryCode) {
    return `${defaultCountryCode}${digitos}@c.us`;
  }

  return `${digitos}@c.us`;
}

const allowedCnpj = somenteDigitos(process.env.INSTADELIVERY_CNPJ || "");
const adminNotifyChatId = numeroParaChatId(process.env.INSTADELIVERY_NOTIFY_TO || "");
const statusLabels = carregarStatusLabels(process.env.INSTADELIVERY_STATUS_LABELS || "");

let ultimoQr = null;
let qrDataUrl = null;
let qrPngBuffer = null;
let qrAtualizadoEm = null;
let botConectado = false;

const sessions = new Map();
const antiSpam = new Map();
const pedidosRecentes = new Map();
const pedidosPorTelefone = new Map();
const MAX_PEDIDOS_RECENTES = 200;
const MAX_PEDIDOS_POR_TELEFONE = 10;

const headersSemCache = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Surrogate-Control": "no-store",
};

function escapeHtml(valor = "") {
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizarTexto(texto = "") {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function chatIdParaNumero(chatId = "") {
  return somenteDigitos(String(chatId).split("@")[0] || "");
}

function parseNumero(valor) {
  if (valor === null || valor === undefined || valor === "") {
    return 0;
  }

  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : 0;
  }

  const texto = String(valor).trim();
  let normalizado = texto;

  if (texto.includes(",") && texto.includes(".")) {
    normalizado = texto.replace(/\./g, "").replace(",", ".");
  } else if (texto.includes(",")) {
    normalizado = texto.replace(",", ".");
  }

  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}

function formatarMoeda(valor) {
  return parseNumero(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function valorOuPadrao(valor, padrao = "Nao informado") {
  if (valor === null || valor === undefined || valor === "") {
    return padrao;
  }

  return String(valor);
}

function resumirEndereco(pedido) {
  const partes = [
    pedido.logradouro,
    pedido.numero,
    pedido.complemento,
    pedido.bairro,
    pedido.cep,
    pedido.cidade,
  ].filter(Boolean);

  return partes.length ? partes.join(", ") : "Nao informado";
}

function obterDescricaoStatus(status) {
  const chave = String(status ?? "");
  return statusLabels[chave] || `codigo ${chave || "desconhecido"}`;
}

function obterFormaPagamento(pedido) {
  if (!pedido.formasPagamento.length) {
    return "Nao informado";
  }

  return pedido.formasPagamento.join(", ");
}

function limitarPedidosRecentes() {
  while (pedidosRecentes.size > MAX_PEDIDOS_RECENTES) {
    const primeiroId = pedidosRecentes.keys().next().value;
    pedidosRecentes.delete(primeiroId);
  }
}

function indexarPedidoPorTelefone(telefone, pedidoId) {
  if (!telefone) {
    return;
  }

  const lista = pedidosPorTelefone.get(telefone) || [];
  const semDuplicado = lista.filter((id) => id !== pedidoId);
  semDuplicado.push(pedidoId);

  while (semDuplicado.length > MAX_PEDIDOS_POR_TELEFONE) {
    semDuplicado.shift();
  }

  pedidosPorTelefone.set(telefone, semDuplicado);
}

function normalizarPedido(payload = {}) {
  const itens = Array.isArray(payload.codigo_item) ? payload.codigo_item : [];
  const descricoes = Array.isArray(payload.descricao_item) ? payload.descricao_item : [];
  const quantidades = Array.isArray(payload.quantidade_item) ? payload.quantidade_item : [];
  const valoresUnitarios = Array.isArray(payload.valor_unitario_item)
    ? payload.valor_unitario_item
    : [];
  const valoresTotais = Array.isArray(payload.valor_total_item) ? payload.valor_total_item : [];
  const grupos = Array.isArray(payload.grupo_item) ? payload.grupo_item : [];

  const telefone = somenteDigitos(payload.telefone_destinatario || "");
  const chatId = numeroParaChatId(telefone);
  const telefoneNormalizado = chatId ? chatIdParaNumero(chatId) : telefone;
  const pedidoId = String(payload.order_id || payload.codigo_parceiro || "").trim();
  const status = payload.status ?? null;

  return {
    pedidoId,
    status,
    origem: payload.origem ?? null,
    storeId: payload.store_id ?? null,
    cnpjLoja: somenteDigitos(payload.cadastro_nacional || ""),
    dataVenda: payload.data_venda || null,
    valorVenda: parseNumero(payload.valor_venda),
    observacoes: payload.observacoes_venda || "",
    formasPagamento: Array.isArray(payload.forma_pagamento)
      ? payload.forma_pagamento.map(String)
      : [],
    valoresPagos: Array.isArray(payload.valor_pago) ? payload.valor_pago.map(parseNumero) : [],
    valorTroco: parseNumero(payload.valor_troco),
    nomeCliente: valorOuPadrao(payload.nome_destinatario),
    telefoneCliente: telefoneNormalizado,
    telefoneClienteOriginal: telefone,
    telefoneClienteChatId: chatId,
    documentoCliente: somenteDigitos(payload.cadastro_nacional_destinatario || ""),
    desconto: parseNumero(payload.valor_desconto),
    acrescimo: parseNumero(payload.valor_acrescimo),
    taxaEntrega: parseNumero(payload.valor_taxa),
    bairro: payload.bairro_destinatario || "",
    logradouro: payload.logradouro_destinatario || "",
    numero: valorOuPadrao(payload.numero_destinatario, ""),
    complemento: payload.complemento_destinatario || "",
    cep: somenteDigitos(payload.cep_destinatario || ""),
    cidade: payload.cidade || "",
    agendamento: payload.agendamento || "",
    referencia: payload.referencia || "",
    codigoParceiro: payload.codigo_parceiro ?? null,
    recebidoEm: new Date().toISOString(),
    itens: itens.map((codigo, index) => ({
      codigo,
      descricao: descricoes[index] || `Item ${index + 1}`,
      quantidade: Number(quantidades[index] || 0),
      valorUnitario: parseNumero(valoresUnitarios[index]),
      valorTotal: parseNumero(valoresTotais[index]),
      grupo: grupos[index] || "",
    })),
  };
}

function salvarPedido(pedido) {
  pedidosRecentes.set(pedido.pedidoId, pedido);
  limitarPedidosRecentes();

  if (pedido.telefoneCliente) {
    indexarPedidoPorTelefone(pedido.telefoneCliente, pedido.pedidoId);
  }
}

function buscarPedidoPorId(pedidoId) {
  return pedidosRecentes.get(String(pedidoId));
}

function buscarUltimoPedidoPorTelefone(chatId) {
  const telefone = chatIdParaNumero(chatId);
  const ids = pedidosPorTelefone.get(telefone) || [];
  const ultimoId = ids[ids.length - 1];
  return ultimoId ? buscarPedidoPorId(ultimoId) : null;
}

function extrairPedidoId(texto) {
  const match = texto.match(/pedido\s*#?\s*(\d+)/i);
  return match ? match[1] : null;
}

function formatarResumoPedido(pedido) {
  const itens = pedido.itens.length
    ? pedido.itens
        .slice(0, 5)
        .map(
          (item) =>
            `- ${item.quantidade || 1}x ${item.descricao} (${formatarMoeda(item.valorTotal)})`
        )
        .join("\n")
    : "- Itens nao enviados pelo webhook";

  return [
    `Pedido #${pedido.pedidoId}`,
    `Status: ${obterDescricaoStatus(pedido.status)}`,
    `Cliente: ${pedido.nomeCliente}`,
    `Total: ${formatarMoeda(pedido.valorVenda)}`,
    `Taxa de entrega: ${formatarMoeda(pedido.taxaEntrega)}`,
    `Pagamento: ${obterFormaPagamento(pedido)}`,
    `Endereco: ${resumirEndereco(pedido)}`,
    pedido.agendamento ? `Agendamento: ${pedido.agendamento}` : null,
    pedido.referencia ? `Referencia: ${pedido.referencia}` : null,
    "",
    "Itens:",
    itens,
  ]
    .filter(Boolean)
    .join("\n");
}

async function enviarMensagemSegura(chatId, texto) {
  if (!chatId || !texto) {
    return { ok: false, motivo: "chat_invalido" };
  }

  try {
    await client.sendMessage(chatId, texto);
    return { ok: true };
  } catch (erro) {
    console.log(`Falha ao enviar mensagem para ${chatId}:`, erro.message);
    return { ok: false, motivo: erro.message };
  }
}

async function notificarCliente(pedido, evento, pedidoAnterior) {
  if (!pedido.telefoneClienteChatId) {
    return { ok: false, motivo: "telefone_ausente" };
  }

  if (pedidoAnterior && String(pedidoAnterior.status) === String(pedido.status)) {
    return { ok: false, motivo: "status_repetido" };
  }

  const titulo =
    evento === "novo_pedido"
      ? `Recebi seu pedido #${pedido.pedidoId} no InstaDelivery.`
      : `Atualizacao do pedido #${pedido.pedidoId}.`;

  const texto = [
    titulo,
    `Status atual: ${obterDescricaoStatus(pedido.status)}`,
    `Total: ${formatarMoeda(pedido.valorVenda)}`,
    pedido.agendamento ? `Agendamento: ${pedido.agendamento}` : null,
    "",
    `Se quiser acompanhar por aqui, responda com *meu pedido* ou *pedido ${pedido.pedidoId}*.`,
  ]
    .filter(Boolean)
    .join("\n");

  return enviarMensagemSegura(pedido.telefoneClienteChatId, texto);
}

async function notificarLoja(pedido, evento) {
  if (!adminNotifyChatId) {
    return { ok: false, motivo: "notificacao_loja_desativada" };
  }

  const texto = [
    evento === "novo_pedido" ? "Novo pedido recebido via webhook." : "Pedido atualizado via webhook.",
    formatarResumoPedido(pedido),
  ].join("\n\n");

  return enviarMensagemSegura(adminNotifyChatId, texto);
}

function responderJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    ...headersSemCache,
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(body));
}

function coletarBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (body.length > 1024 * 1024) {
        reject(new Error("Payload excede 1MB"));
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function validarWebhook(req, payload) {
  if (!webhookToken) {
    return true;
  }

  const authHeader = req.headers.authorization || "";
  const headerToken = req.headers["x-webhook-token"] || req.headers["x-instadelivery-token"] || "";
  const queryToken = new URL(req.url, `http://${req.headers.host || "localhost"}`).searchParams.get(
    "token"
  );
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
  const payloadToken = payload && typeof payload === "object" ? payload.token : "";

  return [headerToken, queryToken, bearer, payloadToken].some(
    (valor) => String(valor || "").trim() === webhookToken
  );
}

async function tratarWebhookInstadelivery(req, res) {
  try {
    const body = await coletarBody(req);
    const payload = body ? JSON.parse(body) : {};

    if (!validarWebhook(req, payload)) {
      responderJson(res, 401, { ok: false, error: "token_invalido" });
      return;
    }

    const pedido = normalizarPedido(payload);

    if (!pedido.pedidoId) {
      responderJson(res, 400, { ok: false, error: "order_id_obrigatorio" });
      return;
    }

    if (allowedStoreId && Number(pedido.storeId) !== allowedStoreId) {
      responderJson(res, 403, { ok: false, error: "store_id_nao_autorizado" });
      return;
    }

    if (allowedCnpj && pedido.cnpjLoja && pedido.cnpjLoja !== allowedCnpj) {
      responderJson(res, 403, { ok: false, error: "cnpj_nao_autorizado" });
      return;
    }

    const pedidoAnterior = buscarPedidoPorId(pedido.pedidoId);
    const evento = pedidoAnterior ? "atualizacao" : "novo_pedido";

    salvarPedido(pedido);

    const [cliente, loja] = await Promise.all([
      notificarCliente(pedido, evento, pedidoAnterior),
      notificarLoja(pedido, evento),
    ]);

    responderJson(res, 200, {
      ok: true,
      evento,
      pedidoId: pedido.pedidoId,
      status: pedido.status,
      clienteNotificado: cliente.ok,
      lojaNotificada: loja.ok,
      recebidoEm: pedido.recebidoEm,
    });
  } catch (erro) {
    console.log("Erro ao processar webhook do InstaDelivery:", erro);
    responderJson(res, 500, { ok: false, error: erro.message || "erro_interno" });
  }
}

async function atualizarQrImagem(qr) {
  ultimoQr = qr;
  qrAtualizadoEm = new Date().toISOString();

  try {
    const opcoesQr = {
      errorCorrectionLevel: "H",
      margin: 2,
      scale: 12,
      width: 420,
      type: "image/png",
    };

    qrDataUrl = await QRCode.toDataURL(qr, opcoesQr);
    qrPngBuffer = await QRCode.toBuffer(qr, opcoesQr);
    console.log("QR Code atualizado. Abra /qr para escanear.");
  } catch (erro) {
    qrDataUrl = null;
    qrPngBuffer = null;
    console.log("Erro ao gerar imagem do QR:", erro.message);
  }
}

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  },
});

client.on("qr", async (qr) => {
  console.log("Escaneie o QR Code:");
  qrcode.generate(qr, { small: false });
  await atualizarQrImagem(qr);
});

client.on("ready", () => {
  botConectado = true;
  ultimoQr = null;
  qrDataUrl = null;
  qrPngBuffer = null;
  qrAtualizadoEm = new Date().toISOString();
  console.log("BOT ONLINE COM SUCESSO");
});

client.on("disconnected", (reason) => {
  botConectado = false;
  ultimoQr = null;
  qrDataUrl = null;
  qrPngBuffer = null;
  console.log("WhatsApp desconectado:", reason);
});

const bairros = {
  "vila santa rita": 0,
  "3 e 4 secao": 0,
  amazonas: 0,
  "atila de paiva": 0,
  bandeirantes: 0,
  barreirinho: 0,
  barreiro: 0,
  bomsucesso: 0,
  "brasil industrial": 0,
  cardoso: 0,
  colorado: 0,
  "conjunto ademar maldonado": 0,
  "conjunto tunel de ibirite": 0,
  corumbiara: 0,
  "cruz de malta": 0,
  diamante: 0,
  "distrito industrial": 0,
  "durval de barros": 0,
  "eliana silva": 0,
  "flavio marques lisboa": 0,
  "flavio de oliveira": 0,
  formosa: 0,
  incofidentes: 0,
  independencia: 0,
  industrial: 0,
  marilandia: 0,
  "jardim industrial": 0,
  "jardim riacho das pedras": 0,
  "jardim do vale": 0,
  "jatoba 4": 0,
  lindeia: 0,
  "los angeles": 0,
  mangueiras: 0,
  milionarios: 0,
  mineirao: 0,
  "morada da serra": 0,
  "nossa senhora de lourdes": 0,
  palmares: 0,
  "parque elizabeth": 0,
  petropolis: 0,
  piratininga: 0,
  pongelupe: 0,
  portelinha: 0,
  "santa maria": 0,
  "sol nascente": 0,
  "solar do barreiro": 0,
  tirol: 0,
  urucuia: 0,
  "vale do jatoba": 0,
  "vila cemig": 0,
  "vila ecologica": 0,
  "vila ideal": 0,
  "vila pinho": 0,
  "vitoria da conquista": 0,
  "aguas claras": 0,
  "aguia dourada": 0,
  miramar: 0,
  araguaia: 0,
  "santa cecilia": 0,
};

const gatilhosMenu = /^(menu|oi|ola|bom dia|boa tarde|boa noite|pedido|opa)$/i;
const gatilhosCompra = [
  "cerveja",
  "cervejas",
  "bebida",
  "bebidas",
  "whisky",
  "vodka",
  "gin",
  "energetico",
  "refrigerante",
  "carvao",
  "gelo",
  "comprar",
  "pedir",
  "pedido",
];
const gatilhosAgradecimento = [
  "obrigado",
  "obrigada",
  "valeu",
  "agradecido",
  "agradecida",
  "tmj",
  "show",
];
const gatilhosConfirmacao = ["ok", "okay", "blz", "beleza", "certo", "fechou", "top"];
const gatilhosDespedida = ["ate mais", "tchau", "falou", "fui", "boa noite", "bom descanso"];
const gatilhosPosterior = [
  "vou pedir depois",
  "depois eu peco",
  "depois eu faco",
  "mais tarde eu peco",
  "vou ver depois",
];
const gatilhosCordialidade = ["tudo bem", "td bem", "como voce esta"];
const gatilhosCardapio = [
  "manda o cardapio",
  "me manda o cardapio",
  "envia o cardapio",
  "quero ver o cardapio",
  "cardapio",
];
const gatilhosConsultaPedido = [
  "meu pedido",
  "acompanhar pedido",
  "status do pedido",
  "como esta meu pedido",
];

const horarioFuncionamento = `
Horario de Funcionamento

Quarta a Sexta: 10h as 22h
Sabado: 10h as 23:59
Domingo: 10h as 23:59

Estamos esperando seu pedido.
`;

const enderecoLoja = `
Nosso Endereco

Rua Jose Pedro de Brito, 407
Vila Santa Rita - Belo Horizonte

https://maps.app.goo.gl/3PtSGsGTevirUPYKA
`;

const menuPrincipal = `Fortin Delivery

Seu pedido de bebidas esta a poucos cliques.

Faca seu pedido pelo cardapio:
${linkPrincipal}

Escolha uma opcao:

1. Taxa de entrega
2. Bairros atendidos
3. Horario de funcionamento
4. Endereco
5. Acompanhar ultimo pedido`;

const mensagemCompraDireta = `Trabalhamos com bebidas e itens para seu pedido gelado sair rapido.

Monte seu pedido no cardapio:
${linkPrincipal}

Se quiser, eu tambem posso te ajudar com:
1. Taxa de entrega
2. Bairros atendidos
3. Horario de funcionamento
4. Endereco
5. Acompanhar ultimo pedido`;

const mensagemAgradecimento = `Nos que agradecemos pelo contato.

Quando quiser pedir sua bebida, e so chamar.

Seu cardapio esta aqui:
${linkPrincipal}

Se precisar, digite menu para ver as opcoes.`;

const mensagemConfirmacao = `Perfeito.

Se quiser seguir com seu pedido, e so acessar:
${linkPrincipal}

Se precisar de ajuda, digite menu.`;

const mensagemDespedida = `Combinado. Estaremos por aqui.

Quando quiser pedir sua bebida:
${linkPrincipal}

Ate mais.`;

const mensagemPosterior = `Sem problema.

Quando for a hora de pedir, seu cardapio estara aqui:
${linkPrincipal}

Se precisar, e so voltar e digitar menu.`;

const mensagemCordialidade = `Tudo certo por aqui.

Se quiser, posso te ajudar com seu pedido de bebidas, taxa de entrega, horario, endereco ou acompanhamento do ultimo pedido.

Digite menu para ver as opcoes.`;

const mensagemCardapio = `Claro.

Voce pode ver e montar seu pedido por aqui:
${linkPrincipal}

Se quiser, tambem posso te ajudar com taxa de entrega, bairros atendidos, horario, endereco e status do pedido.`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function responderConsultaPedido(msg, texto, typing) {
  const pedidoId = extrairPedidoId(texto);
  const pedido = pedidoId ? buscarPedidoPorId(pedidoId) : buscarUltimoPedidoPorTelefone(msg.from);

  await typing();

  if (!pedido) {
    await client.sendMessage(
      msg.from,
      `Ainda nao encontrei um pedido vinculado a este numero.

Se voce acabou de finalizar no InstaDelivery, aguarde alguns segundos e tente novamente com *meu pedido*.

Se preferir, continue seu atendimento por aqui:
${linkPrincipal}`
    );
    return true;
  }

  await client.sendMessage(
    msg.from,
    `${formatarResumoPedido(pedido)}

Se quiser fazer um novo pedido:
${linkPrincipal}`
  );
  return true;
}

const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "POST" && url.pathname === webhookPath) {
      await tratarWebhookInstadelivery(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/instadelivery/orders") {
      const pedidoId = url.searchParams.get("id");
      const pedido = pedidoId ? buscarPedidoPorId(pedidoId) : null;

      if (!pedido) {
        responderJson(res, 404, { ok: false, error: "pedido_nao_encontrado" });
        return;
      }

      responderJson(res, 200, { ok: true, pedido });
      return;
    }

    if (req.method === "GET" && url.pathname === "/qr.png") {
      if (!qrPngBuffer) {
        responderJson(res, 404, {
          status: botConectado ? "conectado" : "aguardando_qr",
        });
        return;
      }

      res.writeHead(200, {
        ...headersSemCache,
        "Content-Type": "image/png",
        "Content-Length": qrPngBuffer.length,
      });
      res.end(qrPngBuffer);
      return;
    }

    if (req.method === "GET" && url.pathname === "/qr") {
      const pagina = qrDataUrl
        ? `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="15" />
    <title>QR Code WhatsApp</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe6;
        --card: #fffdf8;
        --text: #1f2937;
        --muted: #6b7280;
        --accent: #1d9b5f;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, #fff7df 0, transparent 35%),
          linear-gradient(180deg, #f8f1e7 0%, var(--bg) 100%);
        font-family: Arial, sans-serif;
        color: var(--text);
        padding: 24px;
      }
      main {
        width: min(100%, 560px);
        background: var(--card);
        border-radius: 24px;
        padding: 24px;
        box-shadow: 0 18px 40px rgba(31, 41, 55, 0.12);
        text-align: center;
      }
      img {
        width: min(100%, 420px);
        height: auto;
        background: #fff;
        border-radius: 18px;
        padding: 16px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 28px;
      }
      p {
        margin: 0 0 12px;
        color: var(--muted);
        line-height: 1.5;
      }
      .status {
        display: inline-block;
        margin-top: 16px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(29, 155, 95, 0.12);
        color: var(--accent);
        font-size: 14px;
        font-weight: bold;
      }
      code {
        display: block;
        margin-top: 16px;
        word-break: break-all;
        color: var(--muted);
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Escaneie o QR Code</h1>
      <p>Abra esta pagina no celular ou no computador. Ela recarrega sozinha e usa uma imagem PNG sem cache para facilitar a leitura.</p>
      <img src="/qr.png?t=${encodeURIComponent(qrAtualizadoEm || "")}" alt="QR Code do WhatsApp" />
      <div class="status">Atualizado em: ${escapeHtml(qrAtualizadoEm || "")}</div>
      <code>/qr.png</code>
    </main>
  </body>
</html>`
        : botConectado
        ? `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="20" />
    <title>WhatsApp Conectado</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, #e8fff2 0, transparent 35%),
          linear-gradient(180deg, #effaf3 0%, #e5f7eb 100%);
        font-family: Arial, sans-serif;
        padding: 24px;
        text-align: center;
        color: #14532d;
      }
      main {
        max-width: 480px;
        background: #fcfffd;
        border-radius: 24px;
        padding: 28px;
        box-shadow: 0 18px 40px rgba(20, 83, 45, 0.12);
      }
      .status {
        display: inline-block;
        margin-top: 12px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(22, 163, 74, 0.14);
        color: #15803d;
        font-size: 14px;
        font-weight: bold;
      }
      p {
        color: #166534;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>WhatsApp conectado</h1>
      <p>O bot ja esta autenticado. Nao e preciso escanear um novo QR agora.</p>
      <div class="status">Atualizado em: ${escapeHtml(qrAtualizadoEm || new Date().toISOString())}</div>
    </main>
  </body>
</html>`
        : `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="10" />
    <title>QR Code WhatsApp</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f4efe6;
        font-family: Arial, sans-serif;
        padding: 24px;
        text-align: center;
        color: #1f2937;
      }
      main {
        max-width: 480px;
        background: #fffdf8;
        border-radius: 24px;
        padding: 24px;
        box-shadow: 0 18px 40px rgba(31, 41, 55, 0.12);
      }
      p {
        color: #6b7280;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Aguardando QR Code</h1>
      <p>Assim que o WhatsApp gerar um novo QR, esta pagina vai exibir a imagem automaticamente.</p>
    </main>
  </body>
</html>`;

      res.writeHead(200, {
        ...headersSemCache,
        "Content-Type": "text/html; charset=utf-8",
      });
      res.end(pagina);
      return;
    }

    const status = ultimoQr ? "qr_disponivel" : botConectado ? "conectado" : "aguardando_qr";

    responderJson(res, 200, {
      status,
      qrPagePath: "/qr",
      qrImagePath: "/qr.png",
      updatedAt: qrAtualizadoEm,
      instadeliveryWebhookPath: webhookPath,
      pedidosEmMemoria: pedidosRecentes.size,
    });
  } catch (erro) {
    console.log("Erro no servidor HTTP:", erro);
    responderJson(res, 500, { ok: false, error: "erro_interno" });
  }
});

servidor.listen(porta, () => {
  console.log(`Painel do QR ativo na porta ${porta}. Use /qr para abrir a imagem.`);
  console.log(`Webhook InstaDelivery disponivel em ${webhookPath}.`);
});

client.initialize();

client.on("message", async (msg) => {
  try {
    if (!msg.from) return;
    if (msg.from === "status@broadcast") return;
    if (msg.from.endsWith("@g.us")) return;
    if (msg.fromMe) return;
    if (!msg.body) return;

    const agora = Date.now();
    const ultimo = antiSpam.get(msg.from) || 0;

    if (agora - ultimo < 3000) return;

    antiSpam.set(msg.from, agora);

    const chat = await msg.getChat();
    if (chat.isGroup) return;

    const textoOriginal = msg.body.trim();
    const texto = normalizarTexto(textoOriginal);

    if (!sessions.has(msg.from)) {
      sessions.set(msg.from, { etapa: "menu" });
    }

    const session = sessions.get(msg.from);

    const typing = async () => {
      await chat.sendStateTyping();
      await delay(1500);
    };

    if (
      gatilhosConsultaPedido.some((item) => texto.includes(item)) ||
      extrairPedidoId(texto)
    ) {
      await responderConsultaPedido(msg, texto, typing);
      session.etapa = "menu";
      return;
    }

    if (gatilhosMenu.test(texto)) {
      await typing();
      await client.sendMessage(msg.from, menuPrincipal);
      session.etapa = "menu";
      return;
    }

    if (gatilhosCardapio.some((item) => texto.includes(item))) {
      await typing();
      await client.sendMessage(msg.from, mensagemCardapio);
      session.etapa = "menu";
      return;
    }

    if (gatilhosCompra.some((item) => texto.includes(item))) {
      await typing();
      await client.sendMessage(msg.from, mensagemCompraDireta);
      session.etapa = "menu";
      return;
    }

    if (gatilhosAgradecimento.some((item) => texto.includes(item))) {
      await typing();
      await client.sendMessage(msg.from, mensagemAgradecimento);
      session.etapa = "menu";
      return;
    }

    if (gatilhosCordialidade.some((item) => texto.includes(item))) {
      await typing();
      await client.sendMessage(msg.from, mensagemCordialidade);
      session.etapa = "menu";
      return;
    }

    if (
      gatilhosConfirmacao.some(
        (item) => texto === item || texto.includes(`${item} `) || texto.endsWith(item)
      )
    ) {
      await typing();
      await client.sendMessage(msg.from, mensagemConfirmacao);
      session.etapa = "menu";
      return;
    }

    if (gatilhosPosterior.some((item) => texto.includes(item))) {
      await typing();
      await client.sendMessage(msg.from, mensagemPosterior);
      session.etapa = "menu";
      return;
    }

    if (gatilhosDespedida.some((item) => texto.includes(item))) {
      await typing();
      await client.sendMessage(msg.from, mensagemDespedida);
      session.etapa = "menu";
      return;
    }

    if (session.etapa === "menu") {
      if (texto === "1") {
        await typing();
        await client.sendMessage(
          msg.from,
          "Me diga seu bairro para consultar a taxa e agilizar seu pedido."
        );
        session.etapa = "taxa";
        return;
      }

      if (texto === "2") {
        await typing();

        const lista = Object.keys(bairros)
          .map((bairro) => `- ${bairro}`)
          .join("\n");

        await client.sendMessage(
          msg.from,
          `Bairros atendidos

${lista}

Digite seu bairro para consultar a taxa e seguir para o pedido.`
        );

        session.etapa = "taxa";
        return;
      }

      if (texto === "3") {
        await typing();
        await client.sendMessage(msg.from, horarioFuncionamento);
        return;
      }

      if (texto === "4") {
        await typing();
        await client.sendMessage(msg.from, enderecoLoja);
        return;
      }

      if (texto === "5") {
        await responderConsultaPedido(msg, texto, typing);
        session.etapa = "menu";
        return;
      }
    }

    if (session.etapa === "taxa") {
      if (Object.prototype.hasOwnProperty.call(bairros, texto)) {
        const taxa = bairros[texto];

        await typing();

        if (taxa === 0) {
          await client.sendMessage(
            msg.from,
            `Entrega para ${texto} e GRATIS.

Pode aproveitar e fazer seu pedido agora:
${linkPrincipal}`
          );
        } else {
          await client.sendMessage(
            msg.from,
            `Taxa para ${texto}

${formatarMoeda(taxa)}

Faca seu pedido aqui:
${linkPrincipal}`
          );
        }

        session.etapa = "menu";
        return;
      }

      await typing();
      await client.sendMessage(
        msg.from,
        `Ainda nao atendemos esse bairro.

Digite outro bairro ou menu.`
      );
      return;
    }

    await typing();
    await client.sendMessage(
      msg.from,
      `Nao entendi.

Se voce quiser pedir sua bebida agora:
${linkPrincipal}

Digite menu para ver opcoes, *meu pedido* para acompanhar seu ultimo pedido, ou me envie o nome da bebida que voce procura.`
    );
  } catch (erro) {
    console.log("ERRO:", erro);
  }
});
