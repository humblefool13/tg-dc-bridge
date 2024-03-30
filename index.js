require("dotenv").config();
const fetch = require("node-fetch");
const { readFileSync, writeFileSync } = require("fs");

// Globals

let ready = {
  discord: false,
  telegram: false,
};
let channel, webhook;

// Change this for yourself

let telegramChannelId = process.env.tg_ch_id;
let discordChannelID = process.env.dc_ch_id;
const guildId = process.env.dc_gl_id;

// Telegram Bot

let bot;

async function initializeTelegramBot() {
  const TelegramBot = require("node-telegram-bot-api");
  bot = new TelegramBot(process.env.tg_token, { polling: true });
  ready.telegram = true;
  console.log(`Telegram Bot: Ready! Logged in!`);
  // console.log(bot.logOut());
  // console.log(bot.close());
}
initializeTelegramBot();

// Discord Bot

const {
  Client,
  Events,
  GatewayIntentBits,
  MessageType,
} = require("discord.js");
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Discord Bot: Ready! Logged in!`);
  channel = await client.guilds.cache
    .get(guildId)
    .channels.fetch(discordChannelID);
  const webhooks = await channel.fetchWebhooks();
  let found = false;
  webhooks.each((webhook) => {
    if (webhook.name === "BridgeBotWebhook") found = true;
  });
  if (!found) {
    webhook = await channel.createWebhook({
      name: "BridgeBotWebhook",
      reason: "This webhook is used to bridge telegram messages to discord.",
    });
  } else {
    webhook = webhooks.find((webhook) => webhook.name === "BridgeBotWebhook");
  }

  ready.discord = true;
});

// LOGIC

bot.on("polling_error", (err) => {
  ready.telegram = false;
  console.log("Error on line 57:");
  console.log(err);
});

bot.on("message", async (msg) => {
  ready.telegram = true;
  if (!ready.discord) return;
  if (msg.from.is_bot) return;
  if (msg.text?.startsWith("/")) return;
  if (msg.chat.type === "private" && msg.text === "/start") {
    bot.sendMessage(
      msg.chat.id,
      "Welcome to the bot!\n\nThis bot only bridges the chats between discord and telegram and has no other functionality."
    );
  } else if (msg.text === "/start") {
    return;
  }
  let attachment = null;
  let pfp;
  if (msg.photo || msg.video || msg.animation) {
    let userAttachment = msg.photo || msg.video || msg.animation;
    const fileId = msg.photo
      ? userAttachment[userAttachment.length - 1].file_id
      : userAttachment.file_id;
    const file = await bot.getFile(fileId);
    const path = file.file_path;
    const url = `https://api.telegram.org/file/bot${process.env.tg_token}/${path}`;
    const response = await fetch(url);
    attachment = await response.buffer();
  }
  const userProfilePhotos = await bot.getUserProfilePhotos(msg.from.id);
  const profilePhoto = userProfilePhotos.photos[0];
  const requiredResolution = profilePhoto[0];
  const pfpFileId = requiredResolution.file_id;
  const pfpFile = await bot.getFile(pfpFileId);
  const pfpPath = pfpFile.file_path;
  const pfpUrl = `https://api.telegram.org/file/bot${process.env.tg_token}/${pfpPath}`;
  if (msg.chat.id != telegramChannelId) return;
  const tgMsgId = msg.message_id;
  let dcMsgId;
  if (msg.reply_to_message) {
    const oldMsgId = msg.reply_to_message.message_id;
    const fileData = getFromFile(oldMsgId);
    if (!fileData) {
      dcMsgId = await sendDiscordMessage(
        msg.text ? msg.text : msg.caption ? msg.caption : null,
        msg.from.username,
        attachment,
        pfpUrl
      );
    } else {
      const discordOldMessage = fileData[2];
      dcMsgId = await sendDiscordReply(
        msg.text ? msg.text : msg.caption ? msg.caption : null,
        msg.from.username,
        attachment,
        discordOldMessage,
        pfpUrl
      );
    }
  } else {
    dcMsgId = await sendDiscordMessage(
      msg.text ? msg.text : msg.caption ? msg.caption : null,
      msg.from.username,
      attachment,
      pfpUrl
    );
  }
  const dataString = `${Date.now()}=${tgMsgId}=${dcMsgId}`;
  putIntoFile(dataString);
});

client.on(Events.MessageCreate, async (message) => {
  if (!ready.telegram) return;
  if (message.author.bot) return;
  if (message.channelId !== discordChannelID) return;
  let attachment = null;
  let tgMsgId;
  if (message.attachments.size) {
    attachment = message.attachments.at(0);
  }
  if (message.type === MessageType.Reply) {
    const originalMessageDc = await channel.messages.fetch(
      message.reference.messageId
    );
    const fileData = getFromFile(originalMessageDc.id);
    if (!fileData) {
      tgMsgId = await sendTelegramMessage(
        message.content,
        message.member.displayName,
        attachment
      );
    } else {
      const tgOldMsg = fileData[1];
      tgMsgId = await sendTelegramReply(
        message.content,
        message.member.displayName,
        attachment,
        tgOldMsg
      );
    }
  } else {
    tgMsgId = await sendTelegramMessage(
      message.content,
      message.member.displayName,
      attachment
    );
  }
  const dcMsgId = message.id;
  const dataString = `${Date.now()}=${tgMsgId}=${dcMsgId}`;
  putIntoFile(dataString);
});

function putIntoFile(string) {
  let fileContent = readFileSync("msgdata.txt", {
    encoding: "utf-8",
    flag: "r",
  });
  fileContent += "\n" + string;
  writeFileSync("msgdata.txt", fileContent);
}

function getFromFile(string) {
  const fileContent = readFileSync("msgdata.txt", {
    encoding: "utf-8",
    flag: "r",
  });
  const lines = fileContent.split("\n");
  const found = lines.find((line) => line.includes(string));
  if (!found) return null;
  return found.split("=");
}

function purgeOldFromFile() {
  const fileContent = readFileSync("msgdata.txt", {
    encoding: "utf-8",
    flag: "r",
  });
  const lines = fileContent.split("\n");
  const newLines = lines.filter((line) => {
    const element = line.split("=");
    return Date.now() - Number(element[0]) < 24 * 60 * 60 * 1000;
  });
  writeFileSync("msgdata.txt", newLines.join("\n"));
}
purgeOldFromFile();
setInterval(purgeOldFromFile, 1 * 60 * 60 * 1000);

async function sendDiscordMessage(content, username, attachment, pfpUrl) {
  if (!attachment && content) {
    const msg = await webhook.send({
      username: username + " On Telegram",
      avatarURL: pfpUrl,
      content: content,
    });
    return msg.id;
  } else {
    const msg = await webhook.send({
      username: username + " On Telegram",
      avatarURL: pfpUrl,
      content: `${content || "Attachment below!"}`,
      files: [
        {
          attachment: attachment,
        },
      ],
    });
    return msg.id;
  }
}

async function sendDiscordReply(
  content,
  username,
  attachment,
  originalMessage,
  pfpUrl
) {
  const oldMessage = await channel.messages.fetch(originalMessage);
  if (!oldMessage) {
    return sendDiscordMessage(content, username, attachment, pfpUrl);
  }
  if (!attachment && content) {
    const msg = await oldMessage.reply(
      `${content}\n\n~ ${username} on Telegram`
    );
    return msg.id;
  } else {
    const msg = await oldMessage.reply({
      content: `${content || ""}\n\n~ ${username} on Telegram`,
      files: [
        {
          attachment: attachment,
        },
      ],
    });
    return msg.id;
  }
}
async function sendTelegramMessage(content, username, attachment) {
  if (!attachment && content) {
    const sentMsg = await bot.sendMessage(
      telegramChannelId,
      `${content}\n\n~ ${username} on Discord`
    );
    return sentMsg.message_id;
  } else {
    if (attachment.contentType.endsWith("gif")) {
      const sentMsg = await bot.sendAnimation(
        telegramChannelId,
        attachment.url,
        {
          caption: `${content ? content : ""}\n\n~ ${username} on Discord`,
        }
      );
      return sentMsg.message_id;
    } else if (attachment.contentType.includes("image")) {
      const sentMsg = await bot.sendPhoto(telegramChannelId, attachment.url, {
        caption: `${content ? content : ""}\n\n~ ${username} on Discord`,
      });
      return sentMsg.message_id;
    } else if (attachment.contentType.includes("video")) {
      const sentMsg = await bot.sendVideo(telegramChannelId, attachment.url, {
        caption: `${content ? content : ""}\n\n~ ${username} on Discord`,
      });
      return sentMsg.message_id;
    } else {
      sendTelegramMessage(content, username, null);
    }
  }
}

async function sendTelegramReply(
  content,
  username,
  attachment,
  originalMessageTg
) {
  if (!attachment && content) {
    const sentMsg = await bot.sendMessage(
      telegramChannelId,
      `${content}\n\n~ ${username} on Discord`,
      {
        reply_parameters: {
          message_id: originalMessageTg,
        },
      }
    );
    return sentMsg.message_id;
  } else {
    if (attachment.contentType.endsWith("gif")) {
      const sentMsg = await bot.sendAnimation(
        telegramChannelId,
        attachment.url,
        {
          caption: `${content ? content : ""}\n\n~ ${username} on Discord`,
          reply_parameters: {
            message_id: originalMessageTg,
          },
        }
      );
      return sentMsg.message_id;
    } else if (attachment.contentType.includes("image")) {
      const sentMsg = await bot.sendPhoto(telegramChannelId, attachment.url, {
        caption: `${content ? content : ""}\n\n~ ${username} on Discord`,
        reply_parameters: {
          message_id: originalMessageTg,
        },
      });
      return sentMsg.message_id;
    } else if (attachment.contentType.includes("video")) {
      const sentMsg = await bot.sendVideo(telegramChannelId, attachment.url, {
        caption: `${content ? content : ""}\n\n~ ${username} on Discord`,
        reply_parameters: {
          message_id: originalMessageTg,
        },
      });
      return sentMsg.message_id;
    } else {
      return sendTelegramMessage(content, username, null, originalMessageTg);
    }
  }
}

process.on("unhandledRejection", (reason, p) => {
  console.log("Error on line 207:");
  console.log("[ ANTICRASH ] :: Unhandled Rejection / Catch");
  console.log(reason?.stack, p);
});
process.on("uncaughtException", (err, origin) => {
  console.log("Error on line 212:");
  console.log("[ ANTICRASH ] :: Uncaught Exception / Catch");
  console.log(err?.stack, origin);
});
process.on("uncaughtExceptionMonitor", (err, origin) => {
  console.log("Error on line 218:");
  console.log("[ ANTICRASH ] :: Uncaught Exception / Catch { MONITOR }");
  console.log(err?.stack, origin);
});

client.login(process.env.dc_token);
