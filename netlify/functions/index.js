/**
 * Firebase Cloud Functions — модерация заданий через Telegram
 *
 * Установка:
 *   npm install firebase-functions firebase-admin node-fetch
 *
 * Деплой:
 *   firebase deploy --only functions
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch"); // npm i node-fetch@2

admin.initializeApp();
const db = admin.firestore();

// ── ЗАМЕНИТЕ НА СВОИ ДАННЫЕ ──────────────────────────────
const TG_TOKEN   = "8910813476:AAET6lE4eBSAUDLIeKG0sR94OwmDKbYh7cA";      // токен от @BotFather
const TG_CHAT_ID = "7922008036"; // ваш Telegram chat_id (число)
// ─────────────────────────────────────────────────────────

const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;

// ── 1. ТРИГГЕР: новое задание → уведомление в Telegram ───
exports.onTaskCreated = functions.firestore
  .document("tasks/{taskId}")
  .onCreate(async (snap, context) => {
    const task   = snap.data();
    const taskId = context.params.taskId;

    // Уведомляем только задания, ожидающие оплату
    if (task.status !== "pending_payment") return null;

    const caption =
      `📋 *Новое задание на модерации*\n\n` +
      `*Название:* ${task.title}\n` +
      `*Описание:* ${task.description}\n` +
      `*Район:* ${task.district}\n` +
      `*Оплата исполнителю:* ${task.pay} ₸\n` +
      `*Автор:* ${task.authorName} (${task.authorPhone})\n` +
      `*ID задания:* \`${taskId}\``;

    const inline_keyboard = [[
      { text: "✅ Опубликовать", callback_data: `approve_${taskId}` },
      { text: "❌ Отклонить",    callback_data: `reject_${taskId}`  }
    ]];

    try {
      if (task.receiptUrl) {
        // Отправляем фото чека с кнопками
        await fetch(`${TG_API}/sendPhoto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TG_CHAT_ID,
            photo:   task.receiptUrl,
            caption,
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard }
          })
        });
      } else {
        // Нет чека — отправляем текст
        await fetch(`${TG_API}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TG_CHAT_ID,
            text: caption + "\n\n⚠️ Чек не прикреплён",
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard }
          })
        });
      }
    } catch (e) {
      console.error("Telegram sendPhoto error:", e);
    }

    return null;
  });


// ── 2. WEBHOOK: обработка нажатий кнопок approve / reject ─
exports.telegramWebhook = functions.https.onRequest(async (req, res) => {
  const body = req.body;

  // Telegram присылает callback_query при нажатии кнопки
  if (!body || !body.callback_query) {
    return res.sendStatus(200); // игнорируем остальные апдейты
  }

  const query      = body.callback_query;
  const data       = query.data;           // "approve_TASKID" или "reject_TASKID"
  const callbackId = query.id;
  const [action, taskId] = data.split("_"); // ["approve","TASKID"] или ["reject","TASKID"]

  if (!taskId || !["approve","reject"].includes(action)) {
    await answerCallback(callbackId, "Неизвестное действие");
    return res.sendStatus(200);
  }

  const taskRef = db.collection("tasks").doc(taskId);
  const taskSnap = await taskRef.get();

  if (!taskSnap.exists) {
    await answerCallback(callbackId, "Задание не найдено");
    return res.sendStatus(200);
  }

  const task = taskSnap.data();

  if (action === "approve") {
    // Публикуем задание
    await taskRef.update({ status: "open" });

    // Уведомляем автора
    await notifyUser(task.authorUid,
      `✅ Ваше задание *«${task.title}»* опубликовано!\n\nОно теперь видно всем пользователям.`
    );

    await answerCallback(callbackId, "✅ Задание опубликовано");

  } else if (action === "reject") {
    // Отклоняем задание
    await taskRef.update({ status: "rejected" });

    // Уведомляем автора
    await notifyUser(task.authorUid,
      `❌ Ваше задание *«${task.title}»* отклонено.\n\nПричина: чек не подтверждён или задание нарушает правила. Свяжитесь с поддержкой.`
    );

    await answerCallback(callbackId, "❌ Задание отклонено");
  }

  return res.sendStatus(200);
});


// ── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ──────────────────────────────

/**
 * Отвечаем на callback_query (убирает "часики" на кнопке)
 */
async function answerCallback(callbackQueryId, text) {
  await fetch(`${TG_API}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text })
  });
}

/**
 * Отправляем сообщение пользователю по userId из Firestore.
 * Требует: при регистрации сохранять telegram_chat_id пользователя в users/{uid}.
 * Если telegram_chat_id нет — просто логируем.
 */
async function notifyUser(authorUid, text) {
  try {
    const userSnap = await db.collection("users").doc(authorUid).get();
    if (!userSnap.exists) return;

    const telegramChatId = userSnap.data().telegramChatId; // сохраняется ботом при /start
    if (!telegramChatId) {
      console.log(`User ${authorUid} has no telegramChatId, skipping notification`);
      return;
    }

    await fetch(`${TG_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text,
        parse_mode: "Markdown"
      })
    });
  } catch (e) {
    console.error("notifyUser error:", e);
  }
}
