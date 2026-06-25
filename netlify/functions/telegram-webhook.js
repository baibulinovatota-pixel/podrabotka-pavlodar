// netlify/functions/telegram-webhook.js
//
// Логика:
// 1. Юзер нажимает /start в боте
// 2. Бот просит поделиться номером телефона
// 3. Telegram отправляет реальный номер юзера
// 4. Бот проверяет — есть ли этот номер в verifyCodes
// 5. Если есть — отправляет код подтверждения
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

async function sendMessage(chatId, text, replyMarkup) {
  const body = { chat_id: chatId, text };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function sendContactRequest(chatId) {
  await sendMessage(
    chatId,
    "Нажмите кнопку ниже, чтобы поделиться своим номером телефона для подтверждения.",
    {
      keyboard: [[{ text: "📱 Поделиться номером", request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    }
  );
}

async function removeKeyboard(chatId, text) {
  await sendMessage(chatId, text, { remove_keyboard: true });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 200, body: "ok" };

  let update;
  try {
    update = JSON.parse(event.body);
  } catch {
    return { statusCode: 200, body: "ok" };
  }

  const msg = update.message;
  if (!msg) return { statusCode: 200, body: "ok" };

  const chatId = msg.chat.id;

  // Пользователь поделился контактом
  if (msg.contact) {
    const contact = msg.contact;

    // Проверяем что это контакт самого пользователя, а не чужой
    if (contact.user_id !== msg.from.id) {
      await removeKeyboard(chatId, "❌ Пожалуйста, поделитесь своим собственным номером телефона.");
      await sendContactRequest(chatId);
      return { statusCode: 200, body: "ok" };
    }

    // Нормализуем номер — убираем всё кроме цифр и добавляем +
    let phone = contact.phone_number.replace(/\D/g, "");
    if (!phone.startsWith("7") && phone.length === 10) phone = "7" + phone;
    phone = "+" + phone;

    try {
      // Ищем код в Firebase по номеру телефона
      const ref = db.collection("verifyCodes").doc(phone);
      const snap = await ref.get();

      if (!snap.exists()) {
        await removeKeyboard(chatId, `❌ Номер ${phone} не найден. Сначала введите номер на сайте и нажмите «Продолжить».`);
        return { statusCode: 200, body: "ok" };
      }

      const data = snap.data();

      if (data.used) {
        await removeKeyboard(chatId, "❌ Этот код уже был использован. Запросите новый на сайте.");
        return { statusCode: 200, body: "ok" };
      }

      if (data.expiresAt && data.expiresAt.toDate() < new Date()) {
        await removeKeyboard(chatId, "❌ Код истёк (срок действия — 10 минут). Запросите новый на сайте.");
        return { statusCode: 200, body: "ok" };
      }

      // Сохраняем chatId
      await ref.set({ chatId }, { merge: true });

      await removeKeyboard(chatId, `✅ Номер подтверждён!\n\nВаш код: *${data.code}*\n\nВведите его на сайте. Код действует 10 минут.`);

    } catch (e) {
      console.error(e);
      await removeKeyboard(chatId, "❌ Произошла ошибка. Попробуйте ещё раз чуть позже.");
    }

    return { statusCode: 200, body: "ok" };
  }

  // Команда /start
  if (msg.text && msg.text.startsWith("/start")) {
    await sendContactRequest(chatId);
    return { statusCode: 200, body: "ok" };
  }

  // Любое другое сообщение
  await sendContactRequest(chatId);
  return { statusCode: 200, body: "ok" };
};