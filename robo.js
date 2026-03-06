// =====================================
// IMPORTAÇÕES
// =====================================
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");

// =====================================
// CLIENTE WHATSAPP
// =====================================
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
    ],
  },
});

// =====================================
// QR CODE
// =====================================
client.on("qr", (qr) => {
  console.log("📲 Escaneie o QR Code:");
  qrcode.generate(qr, { small: true });
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
