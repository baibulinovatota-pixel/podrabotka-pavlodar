// netlify/functions/telegram-webhook.js
//
// Принимает обновления от Telegram-бота подтверждения телефона.
// Юзер на сайте вводит номер -> сайт пишет код в Firestore (verifyCodes/{phone})
// со сроком жизни 10 минут -> юзер открывает бота по ссылке t.me/BOT?start=<phone>
// -> бот присылает текущий код в чат -> юзер вводит этот код на сайте.
//
// ENV переменные (Netlify -> Site settings -> Environment variables):
//   TELEGRAM_BOT_TOKEN        — токен бота от BotFather
//   FIREBASE_PROJECT_ID       — podrabotka-pavlodar
//   FIREBASE_CLIENT_EMAIL     — email сервисного аккаунта Firebase
//   FIREBASE_PRIVATE_KEY      — приватный ключ сервисного аккаунта (с \n внутри строки)

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
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 200, body: "ok" };
  }

  let update;
  try {
    update = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 200, body: "ok" };
  }

  const msg = update.message;
  if (!msg || !msg.text) {
    return { statusCode: 200, body: "ok" };
  }

  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (text.startsWith("/start")) {
    const parts = text.split(/\s+/);
    const phone = parts[1];

    if (!phone) {
      await sendMessage(chatId, "Откройте этого бота по ссылке из приложения «Подработка рядом», чтобы получить код подтверждения.");
      return { statusCode: 200, body: "ok" };
    }

    try {
      const ref = db.collection("verifyCodes").doc(phone);
      const snap = await ref.get();

      if (!snap.exists) {
        await sendMessage(chatId, "Код не найден. Вернитесь на сайт и нажмите «Продолжить» или «Отправить код» ещё раз.");
        return { statusCode: 200, body: "ok" };
      }

      const data = snap.data();

      if (data.used) {
        await sendMessage(chatId, "Этот код уже был использован. Запросите новый на сайте.");
        return { statusCode: 200, body: "ok" };
      }

      if (Date.now() > data.expiresAt) {
        await sendMessage(chatId, "Код истёк (срок действия — 10 минут). Запросите новый на сайте.");
        return { statusCode: 200, body: "ok" };
      }

      await ref.set({ chatId }, { merge: true });

      await sendMessage(chatId, `Ваш код подтверждения: ${data.code}\n\nВведите его на сайте. Код действует 10 минут.`);
    } catch (e) {
      console.error(e);
      await sendMessage(chatId, "Произошла ошибка. Попробуйте ещё раз чуть позже.");
    }

    return { statusCode: 200, body: "ok" };
  }

  return { statusCode: 200, body: "ok" };
};
