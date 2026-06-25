const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();
const BOT_TOKEN = process.env.TELEGRAM_MODERATION_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST")
    return { statusCode: 200, body: "ok" };

  let task, taskId;
  try {
    const body = JSON.parse(event.body);
    task = body.task;
    taskId = body.taskId;
  } catch {
    return { statusCode: 400, body: "bad request" };
  }

  const caption =
    `📋 *Новое задание*\n\n` +
    `*Название:* ${task.title}\n` +
    `*Описание:* ${task.description}\n` +
    `*Район:* ${task.district}\n` +
    `*Оплата:* ${task.pay} ₸\n` +
    `*Автор:* ${task.authorName} (${task.authorPhone})\n` +
    `*ID:* \`${taskId}\``;

  const reply_markup = {
    inline_keyboard: [[
      { text: "✅ Опубликовать", callback_data: `approve_${taskId}` },
      { text: "❌ Отклонить",    callback_data: `reject_${taskId}`  }
    ]]
  };

  const endpoint = task.receiptUrl ? "sendPhoto" : "sendMessage";
  const payload = task.receiptUrl
    ? { chat_id: ADMIN_CHAT_ID, photo: task.receiptUrl, caption, parse_mode: "Markdown", reply_markup }
    : { chat_id: ADMIN_CHAT_ID, text: caption, parse_mode: "Markdown", reply_markup };

  await fetch(`${TG}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return { statusCode: 200, body: "ok" };
};
