// =====================================
// IMPORTAÇÕES
// =====================================
const http = require("http");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");

let ultimoQr = null;
let qrDataUrl = null;
let qrPngBuffer = null;
let qrAtualizadoEm = null;
let botConectado = false;

const escapeHtml = (valor = "") =>
  valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// =====================================
// CLIENTE WHATSAPP
// =====================================
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    }
});

// =====================================
// QR CODE
// =====================================
client.on("qr", (qr) => {
  console.log("📲 Escaneie o QR Code:");
  qrcode.generate(qr, { small: false });
});

// =====================================
// BOT ONLINE
// =====================================
client.on("ready", () => {
  console.log("✅ BOT ONLINE COM SUCESSO");
});

// =====================================
// DESCONEXÃO
// =====================================
client.on("disconnected", (reason) => {
  console.log("⚠️ WhatsApp desconectado:", reason);
});

// =====================================
// INICIAR BOT
// =====================================
const atualizarQrImagem = async (qr) => {
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
    console.log("QR Code atualizado. Abra a rota /qr no Railway para escanear.");
  } catch (erro) {
    qrDataUrl = null;
    qrPngBuffer = null;
    console.log("Erro ao gerar imagem do QR:", erro);
  }
};

client.on("qr", atualizarQrImagem);

client.on("ready", () => {
  botConectado = true;
  ultimoQr = null;
  qrDataUrl = null;
  qrPngBuffer = null;
  qrAtualizadoEm = new Date().toISOString();
});

client.on("disconnected", () => {
  botConectado = false;
  ultimoQr = null;
  qrDataUrl = null;
  qrPngBuffer = null;
});

const porta = Number(process.env.PORT) || 3000;

const headersSemCache = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Surrogate-Control": "no-store",
};

const servidor = http.createServer((req, res) => {
  if (req.url === "/qr.png") {
    if (!qrPngBuffer) {
      res.writeHead(404, {
        ...headersSemCache,
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify({ status: botConectado ? "conectado" : "aguardando_qr" }));
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

  if (req.url === "/qr") {
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

  res.writeHead(200, {
    ...headersSemCache,
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify({ status, qrPagePath: "/qr", qrImagePath: "/qr.png", updatedAt: qrAtualizadoEm }));
});

servidor.listen(porta, () => {
  console.log(`Painel do QR ativo na porta ${porta}. Use /qr para abrir a imagem.`);
});

client.initialize();

// =====================================
// CONTROLES
// =====================================
const sessions = new Map();
const antiSpam = new Map();

// =====================================
// LINK DO CARDÁPIO
// =====================================
const linkPrincipal = "https://instadelivery.com.br/fortindelivery";

// =====================================
// PALAVRAS-CHAVE DE VENDA
// =====================================
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
const gatilhosDespedida = ["ate mais", "até mais", "tchau", "falou", "fui", "boa noite", "bom descanso"];
const gatilhosPosterior = [
  "vou pedir depois",
  "depois eu peço",
  "depois eu faco",
  "mais tarde eu peco",
  "mais tarde eu peço",
  "vou ver depois",
];
const gatilhosCordialidade = ["tudo bem", "td bem", "como voce esta", "como você está"];
const gatilhosCardapio = [
  "manda o cardapio",
  "manda o cardápio",
  "me manda o cardapio",
  "me manda o cardápio",
  "envia o cardapio",
  "envia o cardápio",
  "quero ver o cardapio",
  "quero ver o cardápio",
  "cardapio",
  "cardápio",
];

// =====================================
// NORMALIZAR TEXTO
// =====================================
const normalizarTexto = (texto) =>
  texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

// =====================================
// BAIRROS
// =====================================
const bairros = {
"vila santa rita": 0,
  "3 e 4 seção": 0,
  "amazonas": 0,
  "atila de paiva": 0,
  "bandeirantes": 0,
  "barreirinho": 0,
  "barreiro": 0,
  "bomsucesso": 0,
  "brasil industrial": 0,
  "cardoso": 0,
  "colorado": 0,
  "conjunto ademar maldonado": 0,
  "conjunto túnel de ibirité": 0,
  "corumbiara": 0,
  "cruz de Malta": 0,
  "diamante": 0,
  "distrito industrial": 0,
  "durval de barros": 0,
  "eliana silva": 0,
  "flavio marques lisboa": 0,
  "flavio de oliveira": 0,
  "formosa": 0,
  "incofidentes": 0,
  "independência": 0,
  "industrial": 0,
  "marilandia": 0,
  "jardim industrial": 0,
  "jardim riacho das pedras": 0,
  "jardim do vale": 0,
  "jatoba 4": 0,
  "lindeia": 0,
  "los angeles": 0,
  "mangueiras": 0,
  "milionarios": 0,
  "mineirao": 0,
  "morada da serra": 0,
  "nossa senhora de lourdes": 0,
  "palmares": 0,
  "parque elizabeth": 0,
  "petropolis": 0,
  "piratininga": 0,
  "pongelupe": 0,
  "portelinha": 0,
  "santa maria": 0,
  "sol nascente": 0,
  "solar do barreiro": 0,
  "tirol": 0,
  "urucuia": 0,
  "vale do jatoba": 0,
  "vila cemig": 0,
  "vila ecologica": 0,
  "vila ideal": 0,
  "vila pinho": 0,
  "vitoria da conquista": 0,
  "aguas claras": 0,
  "aguia dourada": 0,
  "miramar": 0,
  "araguaia": 0,
  "santa cecilia": 0,
};

// =====================================
// MENSAGENS
// =====================================
const horarioFuncionamento = `
🕒 *Horário de Funcionamento*

Quarta a Sexta: 10h às 22h  
Sábado: 10h às 23:59  
Domingo: 10h às 23:59  

🍻 Estamos esperando seu pedido!
`;

const enderecoLoja = `
📍 *Nosso Endereço*

Rua José Pedro de Brito, 407  
Vila Santa Rita - Belo Horizonte

https://maps.app.goo.gl/3PtSGsGTevirUPYKA
`;

const menuPrincipal = `🍻 *Fortin Delivery*

Seu pedido de bebidas está a poucos cliques.

Faça seu pedido pelo cardápio:
👉 ${linkPrincipal}

Escolha uma opção:

1️⃣ Taxa de entrega
2️⃣ Bairros atendidos
3️⃣ Horário de funcionamento
4️⃣ Endereço`;

const mensagemCompraDireta = `🍻 Trabalhamos com bebidas e itens para seu pedido gelado sair rápido.

Monte seu pedido no cardápio:
👉 ${linkPrincipal}

Se quiser, eu também posso te ajudar com:
1️⃣ Taxa de entrega
2️⃣ Bairros atendidos
3️⃣ Horário de funcionamento
4️⃣ Endereço`;

const mensagemAgradecimento = `😊 Nós que agradecemos pelo contato!

Quando quiser pedir sua bebida, é só chamar.

Seu cardápio está aqui:
👉 ${linkPrincipal}

Se precisar, digite *menu* para ver as opções.`;

const mensagemConfirmacao = `Perfeito! 👍

Se quiser seguir com seu pedido, é só acessar:
👉 ${linkPrincipal}

Se precisar de ajuda, digite *menu*.`;

const mensagemDespedida = `😊 Combinado! Estaremos por aqui.

Quando quiser pedir sua bebida:
👉 ${linkPrincipal}

Até mais!`;

const mensagemPosterior = `Sem problema! 😊

Quando for a hora de pedir, seu cardápio estará aqui:
👉 ${linkPrincipal}

Se precisar, é só voltar e digitar *menu*.`;

const mensagemCordialidade = `Tudo certo por aqui! 😊

Se quiser, posso te ajudar com seu pedido de bebidas, taxa de entrega, horário ou endereço.

Digite *menu* para ver as opções.`;

const mensagemCardapio = `Claro! 🍻

Você pode ver e montar seu pedido por aqui:
👉 ${linkPrincipal}

Se quiser, também posso te ajudar com taxa de entrega, bairros atendidos, horário e endereço.`;

// =====================================
// DELAY
// =====================================
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// =====================================
// RECEBER MENSAGENS
// =====================================
client.on("message", async (msg) => {

  try {

    // =====================================
    // BLOQUEIOS IMPORTANTES
    // =====================================

    if (!msg.from) return;

    // BLOQUEIA STORIES
    if (msg.from === "status@broadcast") return;

    // BLOQUEIA GRUPOS
    if (msg.from.endsWith("@g.us")) return;

    // BLOQUEIA MENSAGENS DO BOT
    if (msg.fromMe) return;

    // BLOQUEIA MENSAGEM VAZIA
    if (!msg.body) return;

    // =====================================
    // ANTI SPAM
    // =====================================
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

    // =====================================
    // MENU
    // =====================================
    if (gatilhosMenu.test(texto)) {

      await typing();

      await client.sendMessage(msg.from, menuPrincipal);

      session.etapa = "menu";
      return;
    }

    // =====================================
    // INTERESSE DE COMPRA
    // =====================================
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

    // =====================================
    // AGRADECIMENTO
    // =====================================
    if (gatilhosAgradecimento.some((item) => texto.includes(item))) {

      await typing();
      await client.sendMessage(msg.from, mensagemAgradecimento);
      session.etapa = "menu";
      return;
    }

    // =====================================
    // CORDIALIDADE
    // =====================================
    if (gatilhosCordialidade.some((item) => texto.includes(item))) {

      await typing();
      await client.sendMessage(msg.from, mensagemCordialidade);
      session.etapa = "menu";
      return;
    }

    // =====================================
    // CONFIRMACAO
    // =====================================
    if (gatilhosConfirmacao.some((item) => texto === item || texto.includes(`${item} `) || texto.endsWith(item))) {

      await typing();
      await client.sendMessage(msg.from, mensagemConfirmacao);
      session.etapa = "menu";
      return;
    }

    // =====================================
    // PEDIR DEPOIS
    // =====================================
    if (gatilhosPosterior.some((item) => texto.includes(item))) {

      await typing();
      await client.sendMessage(msg.from, mensagemPosterior);
      session.etapa = "menu";
      return;
    }

    // =====================================
    // DESPEDIDA
    // =====================================
    if (gatilhosDespedida.some((item) => texto.includes(item))) {

      await typing();
      await client.sendMessage(msg.from, mensagemDespedida);
      session.etapa = "menu";
      return;
    }

    // =====================================
    // MENU OPÇÕES
    // =====================================
    if (session.etapa === "menu") {

      if (texto === "1") {

        await typing();

        await client.sendMessage(
          msg.from,
          "🚚 Me diga seu *bairro* para consultar a taxa e agilizar seu pedido."
        );

        session.etapa = "taxa";
        return;
      }

      if (texto === "2") {

        await typing();

        const lista = Object.keys(bairros)
          .map((b) => `• ${b}`)
          .join("\n");

        await client.sendMessage(
          msg.from,
`📍 *Bairros atendidos*

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

    }

    // =====================================
    // CONSULTA TAXA
    // =====================================
    if (session.etapa === "taxa") {

      if (texto in bairros) {

        const taxa = bairros[texto];

        await typing();

        if (taxa === 0) {

          await client.sendMessage(
            msg.from,
`🎉 Entrega para *${texto}* é *GRÁTIS*!

Pode aproveitar e fazer seu pedido agora:
👉 ${linkPrincipal}`
          );

        } else {

          await client.sendMessage(
            msg.from,
`🚚 Taxa para *${texto}*

R$ ${taxa},00

Faça seu pedido aqui:
👉 ${linkPrincipal}`
          );

        }

        session.etapa = "menu";
        return;

      } else {

        await typing();

        await client.sendMessage(
          msg.from,
`😕 Ainda não atendemos esse bairro.

Digite outro bairro ou *menu*.`
        );

        return;
      }

    }

    // =====================================
    // FALLBACK
    // =====================================
    await typing();

    await client.sendMessage(
      msg.from,
`😅 Não entendi.

Se você quiser pedir sua bebida agora:
👉 ${linkPrincipal}

Digite *menu* para ver opções ou me envie o nome da bebida que você procura.`
    );

  } catch (erro) {

    console.log("❌ ERRO:", erro);

  }

});
